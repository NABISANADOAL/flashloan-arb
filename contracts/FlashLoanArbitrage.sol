// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPool, IFlashLoanSimpleReceiver} from "./interfaces/IAave.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2.sol";
import {ISwapRouter02} from "./interfaces/IUniswapV3.sol";
import {IBalancerVault} from "./interfaces/IBalancer.sol";
import {ICurvePool} from "./interfaces/ICurve.sol";

/// @title FlashLoanArbitrage
/// @notice Aave V3 flash loan that buys on one Uniswap V2 or V3 venue and sells on another.
///         The loan is uncollateralized and must be repaid, plus premium, in the same transaction.
contract FlashLoanArbitrage is IFlashLoanSimpleReceiver, Ownable {
    using SafeERC20 for IERC20;

    uint8 internal constant VENUE_V2 = 0;
    uint8 internal constant VENUE_V3 = 1;
    uint8 internal constant VENUE_CURVE = 2;
    address internal constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    IPool public immutable POOL;

    struct Leg {
        address router;
        uint8 venue;
        uint24 fee;
        uint256 minOut;
    }

    struct ArbParams {
        Leg buy;
        Leg sell;
        address tokenMid;
        uint256 minProfit;
    }

    event FlashArbExecuted(
        address indexed asset,
        uint256 amount,
        uint256 premium,
        uint256 profit,
        address buyRouter,
        address sellRouter
    );

    error UnauthorizedInitiator();
    error UnauthorizedCaller();
    error UnknownVenue(uint8 venue);
    error Unprofitable(uint256 balance, uint256 owed, uint256 minProfit);

    constructor(address pool) Ownable(msg.sender) {
        POOL = IPool(pool);
    }

    /// @notice Borrow `amount` with no collateral. The contract must already hold the Aave premium.
    ///         Aave sends `amount`, then pulls `amount + premium` back in the same transaction.
    function flashBorrow(address asset, uint256 amount) external onlyOwner {
        POOL.flashLoanSimple(address(this), asset, amount, "", 0);
    }

    /// @notice Start an Aave V3 simple flash loan. `params` is abi-encoded ArbParams.
    function executeFlashArb(address asset, uint256 amount, bytes calldata params) external onlyOwner {
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    /// @notice Balancer flash loan. The vault's flash-loan fee is zero, so only the swap fees apply.
    ///         `params` is abi-encoded ArbParams. Any leftover after repayment is sent to the owner.
    function executeBalancerArb(address asset, uint256 amount, bytes calldata params) external onlyOwner {
        address[] memory tokens = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        tokens[0] = asset;
        amounts[0] = amount;
        IBalancerVault(BALANCER_VAULT).flashLoan(address(this), tokens, amounts, params);
    }

    function receiveFlashLoan(
        address[] calldata tokens,
        uint256[] calldata amounts,
        uint256[] calldata feeAmounts,
        bytes calldata userData
    ) external {
        if (msg.sender != BALANCER_VAULT) revert UnauthorizedCaller();

        address asset = tokens[0];
        uint256 amount = amounts[0];
        uint256 fee = feeAmounts[0];

        if (userData.length != 0) {
            ArbParams memory arb = abi.decode(userData, (ArbParams));
            uint256 midBal = _exchange(arb.buy, asset, arb.tokenMid, amount);
            _exchange(arb.sell, arb.tokenMid, asset, midBal);

            uint256 owed = amount + fee;
            uint256 endBal = IERC20(asset).balanceOf(address(this));
            if (endBal < owed + arb.minProfit) revert Unprofitable(endBal, owed, arb.minProfit);

            uint256 profit = endBal - owed;
            if (profit > 0) IERC20(asset).safeTransfer(owner(), profit);
            emit FlashArbExecuted(asset, amount, fee, profit, arb.buy.router, arb.sell.router);
        }

        IERC20(asset).safeTransfer(BALANCER_VAULT, amount + fee);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        if (initiator != address(this)) revert UnauthorizedInitiator();
        if (msg.sender != address(POOL)) revert UnauthorizedCaller();

        if (params.length == 0) {
            uint256 due = amount + premium;
            uint256 cash = IERC20(asset).balanceOf(address(this));
            if (cash < due) revert Unprofitable(cash, due, 0);
            IERC20(asset).forceApprove(address(POOL), due);
            emit FlashArbExecuted(asset, amount, premium, cash - due, address(0), address(0));
            return true;
        }

        ArbParams memory arb = abi.decode(params, (ArbParams));

        uint256 midBal = _exchange(arb.buy, asset, arb.tokenMid, amount);
        _exchange(arb.sell, arb.tokenMid, asset, midBal);

        uint256 owed = amount + premium;
        uint256 endBal = IERC20(asset).balanceOf(address(this));
        if (endBal < owed + arb.minProfit) revert Unprofitable(endBal, owed, arb.minProfit);

        IERC20(asset).forceApprove(address(POOL), owed);

        uint256 profit = endBal - owed;
        if (profit > 0) {
            IERC20(asset).safeTransfer(owner(), profit);
        }

        emit FlashArbExecuted(asset, amount, premium, profit, arb.buy.router, arb.sell.router);
        return true;
    }

    function rescue(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    function _exchange(Leg memory leg, address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        IERC20(tokenIn).forceApprove(leg.router, amountIn);
        if (leg.venue == VENUE_V2) {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            uint256[] memory amounts =
                IUniswapV2Router02(leg.router).swapExactTokensForTokens(amountIn, leg.minOut, path, address(this), block.timestamp);
            return amounts[amounts.length - 1];
        }
        if (leg.venue == VENUE_V3) {
            return ISwapRouter02(leg.router).exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: leg.fee,
                    recipient: address(this),
                    amountIn: amountIn,
                    amountOutMinimum: leg.minOut,
                    sqrtPriceLimitX96: 0
                })
            );
        }
        if (leg.venue == VENUE_CURVE) {
            int128 i = int128(uint128(leg.fee >> 8));
            int128 j = int128(uint128(leg.fee & 0xff));
            return ICurvePool(leg.router).exchange(i, j, amountIn, leg.minOut);
        }
        revert UnknownVenue(leg.venue);
    }
}
