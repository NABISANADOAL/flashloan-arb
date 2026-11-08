export const AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";

export const TOKENS = {
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, symbol: "WETH" },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, symbol: "USDC" },
  USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, symbol: "USDT" },
  DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, symbol: "DAI" },
  WBTC: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, symbol: "WBTC" },
} as const;

export const ROUTERS = [
  { name: "UniswapV2", router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f" },
  { name: "Sushiswap", router: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F", factory: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac" },
  { name: "PancakeV2", router: "0xEfF92A263d31888d860bD50809A8D171709b7b1c", factory: "0x1097053Fd2ea711dad45caCcc45EfF7548fCB362" },
] as const;

export const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C1";

export const UNISWAP_V3 = {
  name: "UniswapV3",
  router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  fees: [100, 500, 3000, 10000],
} as const;

export const AAVE_PREMIUM_BPS = 5n; // 0.05%

export type TokenKey = keyof typeof TOKENS;

export const CURVE_INDEX: Partial<Record<TokenKey, number>> = {
  DAI: 0,
  USDC: 1,
  USDT: 2,
};

export const SCAN_PAIRS: Array<[TokenKey, TokenKey]> = [
  ["WETH", "USDC"],
  ["WETH", "USDT"],
  ["WETH", "DAI"],
  ["WBTC", "WETH"],
  ["USDC", "USDT"],
  ["USDC", "DAI"],
];

/** Borrow sizes in whole tokens, converted with decimals at scan time. */
export const BORROW_WHOLE: Record<TokenKey, string[]> = {
  WETH: ["1", "5", "10", "25"],
  USDC: ["10000", "50000", "100000", "250000"],
  USDT: ["10000", "50000", "100000"],
  DAI: ["10000", "50000", "100000"],
  WBTC: ["1", "2"],
};
