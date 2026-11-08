# flashloan-arb

Aave V3 **flash loan** (uncollateralized, same-transaction repay) plus a UniV2 ↔ Sushi scanner on Ethereum mainnet state.

This is **not** a term loan. If the round-trip cannot repay `amount + premium` in the same tx, Aave reverts and nothing is borrowed.

## Parameters

| Parameter | Value |
|---|---|
| Chain | Ethereum mainnet (read + fork) |
| Lender | Aave V3 Pool `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Premium | `FLASHLOAN_PREMIUM_TOTAL` (~0.05%) |
| DEX A | Uniswap V2 router `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| DEX B | Sushiswap router `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` |
| Assets | WETH, USDC, USDT, DAI, WBTC |
| Collateral | none (atomic repay) |
| Collateral factor | n/a |
| Min profit | encoded in `ArbParams.minProfit` |

Live broadcast is **opt-in** via a local `PRIVATE_KEY` you never paste into chat. Default run is scan + Hardhat fork.

```bash
npm install
npx hardhat compile
npx hardhat run scripts/scan.ts --network mainnet
npx hardhat run scripts/simulate.ts --network hardhat
npx hardhat test
```
