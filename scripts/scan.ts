import { ethers } from "hardhat";
import {
  BORROW_WHOLE,
  CURVE_3POOL,
  CURVE_INDEX,
  ROUTERS,
  SCAN_PAIRS,
  TOKENS,
  TokenKey,
  UNISWAP_V3,
} from "./addresses";
import { formatUnits, getAmountOut, parseWhole } from "./amm";

const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
];
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160,uint32,uint256)",
];

const GAS_UNITS = 350_000n;
const V3_FEES = [100, 500];
const CURVE_ABI = ["function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)"];

function isTimeout(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|ETIMEDOUT|503|rate/i.test(message);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTimeout(err) || attempt === 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw last;
}

export type Leg = {
  venue: 0 | 1 | 2;
  name: string;
  router: string;
  fee: number;
  quotedOut: bigint;
  minOut: bigint;
};

export type Opportunity = {
  borrow: TokenKey;
  mid: TokenKey;
  buy: Leg;
  sell: Leg;
  amount: bigint;
  amountOut: bigint;
  premium: bigint;
  profit: bigint;
  gasTokens: bigint;
};

type Book = {
  venue: 0 | 1 | 2;
  name: string;
  router: string;
  fee: number;
  reserveA: bigint;
  reserveB: bigint;
};

function minOutFromQuote(quoted: bigint): bigint {
  if (quoted <= 1n) return 1n;
  return (quoted * 99n) / 100n;
}

async function pairReserves(factoryAddr: string, a: string, b: string) {
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, ethers.provider);
  const pairAddr: string = await withRetry(() => factory.getPair(a, b));
  if (pairAddr === ethers.ZeroAddress) return null;
  const pair = new ethers.Contract(pairAddr, PAIR_ABI, ethers.provider);
  const [token0, reserves] = await withRetry(() => Promise.all([pair.token0(), pair.getReserves()]));
  const r0 = BigInt(reserves[0]);
  const r1 = BigInt(reserves[1]);
  const aIs0 = a.toLowerCase() === String(token0).toLowerCase();
  return { reserveA: aIs0 ? r0 : r1, reserveB: aIs0 ? r1 : r0 };
}

async function quoteV3(tokenIn: string, tokenOut: string, amountIn: bigint, fee: number): Promise<bigint | null> {
  const quoter = new ethers.Contract(UNISWAP_V3.quoter, QUOTER_ABI, ethers.provider);
  try {
    const result = await withRetry(() => quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    }));
    const amountOut = BigInt(result[0]);
    return amountOut > 0n ? amountOut : null;
  } catch {
    return null;
  }
}

async function unitsPerEth(borrow: TokenKey): Promise<bigint> {
  if (borrow === "WETH") return 10n ** 18n;
  if (borrow === "WBTC") {
    const wethForBtc = await quoteV3(TOKENS.WBTC.address, TOKENS.WETH.address, 10n ** 8n, 500);
    if (!wethForBtc) return 0n;
    return (10n ** 8n * 10n ** 18n) / wethForBtc;
  }
  const usdc = await quoteV3(TOKENS.WETH.address, TOKENS.USDC.address, 10n ** 18n, 500);
  if (!usdc) return 0n;
  if (borrow === "USDC" || borrow === "USDT") return usdc;
  if (borrow === "DAI") return usdc * 10n ** 12n;
  const unreachable: never = borrow;
  return unreachable;
}

function quoteOnBook(book: Book, amount: bigint, fromA: boolean): bigint {
  const reserveIn = fromA ? book.reserveA : book.reserveB;
  const reserveOut = fromA ? book.reserveB : book.reserveA;
  return getAmountOut(amount, reserveIn, reserveOut);
}

async function quoteCurve(i: number, j: number, amountIn: bigint): Promise<bigint | null> {
  const pool = new ethers.Contract(CURVE_3POOL, CURVE_ABI, ethers.provider);
  try {
    const amountOut = BigInt(await withRetry(() => pool.get_dy(i, j, amountIn)));
    return amountOut > 0n ? amountOut : null;
  } catch {
    return null;
  }
}

function directedFee(book: Book, fromA: boolean): number {
  if (book.venue !== 2 || fromA) return book.fee;
  const i = book.fee >> 8;
  const j = book.fee & 0xff;
  return (j << 8) | i;
}

async function quoteBook(book: Book, amount: bigint, fromA: boolean, tokenIn: string, tokenOut: string): Promise<bigint | null> {
  switch (book.venue) {
    case 0: {
      const out = quoteOnBook(book, amount, fromA);
      return out > 0n ? out : null;
    }
    case 1:
      return quoteV3(tokenIn, tokenOut, amount, book.fee);
    case 2: {
      const fee = directedFee(book, fromA);
      return quoteCurve(fee >> 8, fee & 0xff, amount);
    }
    default: {
      const unreachable: never = book.venue;
      return unreachable;
    }
  }
}

export async function findOpportunities(): Promise<{ profitable: Opportunity[]; nearest: Opportunity[] }> {
  const premiumBps = 0n;

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 20n * 10n ** 9n;
  const gasWei = GAS_UNITS * gasPrice;
  const gasByBorrow = new Map<TokenKey, bigint>();
  for (const key of Object.keys(TOKENS) as TokenKey[]) {
    const units = await unitsPerEth(key);
    gasByBorrow.set(key, units === 0n ? 0n : (gasWei * units) / 10n ** 18n);
  }

  const all: Opportunity[] = [];

  for (const [left, right] of SCAN_PAIRS) {
    const tokenA = TOKENS[left];
    const tokenB = TOKENS[right];
    const books: Book[] = [];

    for (const dex of ROUTERS) {
      const reserves = await pairReserves(dex.factory, tokenA.address, tokenB.address);
      if (!reserves) continue;
      books.push({
        venue: 0,
        name: dex.name,
        router: dex.router,
        fee: 3000,
        reserveA: reserves.reserveA,
        reserveB: reserves.reserveB,
      });
    }

    for (const fee of V3_FEES) {
      const probe = await quoteV3(tokenA.address, tokenB.address, parseWhole("1", tokenA.decimals), fee);
      if (!probe) continue;
      books.push({
        venue: 1,
        name: `${UNISWAP_V3.name}:${fee}`,
        router: UNISWAP_V3.router,
        fee,
        reserveA: 0n,
        reserveB: 0n,
      });
    }

    const curveA = CURVE_INDEX[left];
    const curveB = CURVE_INDEX[right];
    if (curveA !== undefined && curveB !== undefined) {
      books.push({
        venue: 2,
        name: "Curve3pool",
        router: CURVE_3POOL,
        fee: (curveA << 8) | curveB,
        reserveA: 0n,
        reserveB: 0n,
      });
    }
    if (books.length < 2) continue;

    const directions: Array<{ borrow: TokenKey; mid: TokenKey; fromA: boolean }> = [
      { borrow: left, mid: right, fromA: true },
      { borrow: right, mid: left, fromA: false },
    ];

    for (const dir of directions) {
      const token = TOKENS[dir.borrow];
      const mid = TOKENS[dir.mid];
      for (const whole of BORROW_WHOLE[dir.borrow].slice(0, 2)) {
        const amount = parseWhole(whole, token.decimals);
        const buyQuotes: Array<{ book: Book; out: bigint; fee: number }> = [];
        for (const book of books) {
          const out = await quoteBook(book, amount, dir.fromA, token.address, mid.address);
          if (out && out > 0n) buyQuotes.push({ book, out, fee: directedFee(book, dir.fromA) });
        }

        for (const buy of buyQuotes) {
          for (const sellBook of books) {
            if (buy.book.name === sellBook.name) continue;
            const back = await quoteBook(sellBook, buy.out, !dir.fromA, mid.address, token.address);
            if (!back) continue;
            const premium = (amount * premiumBps) / 10000n;
            const profit = back - amount - premium;
            const gasTokens = gasByBorrow.get(dir.borrow) ?? 0n;
            all.push({
              borrow: dir.borrow,
              mid: dir.mid,
              buy: {
                venue: buy.book.venue,
                name: buy.book.name,
                router: buy.book.router,
                fee: buy.fee,
                quotedOut: buy.out,
                minOut: minOutFromQuote(buy.out),
              },
              sell: {
                venue: sellBook.venue,
                name: sellBook.name,
                router: sellBook.router,
                fee: directedFee(sellBook, !dir.fromA),
                quotedOut: back,
                minOut: minOutFromQuote(back),
              },
              amount,
              amountOut: back,
              premium,
              profit,
              gasTokens,
            });
          }
        }
      }
    }
  }

  all.sort((a, b) => (a.profit > b.profit ? -1 : a.profit < b.profit ? 1 : 0));
  const profitable = all.filter((hit) => hit.profit > hit.gasTokens && hit.gasTokens > 0n);
  return { profitable, nearest: all.slice(0, 8) };
}

export function describeOpportunity(hit: Opportunity): string {
  const dec = TOKENS[hit.borrow].decimals;
  return `${hit.borrow}→${hit.mid}→${hit.borrow}  buy=${hit.buy.name} sell=${hit.sell.name}  size=${formatUnits(hit.amount, dec)}  profit=${formatUnits(hit.profit, dec)}  gas≈${formatUnits(hit.gasTokens, dec)} ${hit.borrow}`;
}

async function main() {
  const block = await ethers.provider.getBlockNumber();
  const net = await ethers.provider.getNetwork();
  console.log(`chain=${net.chainId} block=${block}`);
  console.log("Searching Uniswap V2, Sushi, Pancake, Uniswap V3 0.01% and 0.05%, and Curve. Balancer loan fee is zero.");

  const { profitable, nearest } = await findOpportunities();
  if (profitable.length === 0) {
    console.log("No path clears the swap fees and gas. Nothing was sent.");
    console.log("Closest quotes:");
    for (const hit of nearest) console.log(describeOpportunity(hit));
    return;
  }

  for (const hit of profitable.slice(0, 15)) console.log(describeOpportunity(hit));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
