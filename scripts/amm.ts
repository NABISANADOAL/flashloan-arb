export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

export function parseWhole(whole: string, decimals: number): bigint {
  const [i, f = ""] = whole.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(i + frac);
}

export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const s = v.toString().padStart(decimals + 1, "0");
  const head = s.slice(0, s.length - decimals);
  const tail = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${head}${tail ? "." + tail : ""}`;
}
