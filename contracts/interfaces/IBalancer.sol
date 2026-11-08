// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external;
}
