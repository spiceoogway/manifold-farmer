/**
 * Shared P&L and outcome calculation utilities.
 * Used by both resolver.ts (realized P&L) and seller.ts (unrealized P&L).
 */

export function computeWon(
  direction: "YES" | "NO",
  resolution: "YES" | "NO" | "MKT",
  actual: number,
): boolean {
  if (resolution === "MKT") {
    return direction === "YES" ? actual > 0.5 : actual < 0.5;
  }
  return direction === resolution;
}

/**
 * Compute realized P&L from a resolved binary/MKT market.
 * Uses exact share count if available, falls back to market-prob approximation.
 */
export function computeRealizedPnl(
  direction: "YES" | "NO",
  amount: number,
  marketProb: number,
  resolution: "YES" | "NO" | "MKT",
  won: boolean,
  shares?: number,
  resolutionProbability?: number,
): number {
  if (resolution === "MKT") {
    const p = resolutionProbability ?? 0.5;
    if (shares) {
      return direction === "YES" ? shares * p - amount : shares * (1 - p) - amount;
    }
    return direction === "YES"
      ? (amount * (p - marketProb)) / marketProb
      : (amount * (marketProb - p)) / (1 - marketProb);
  }

  if (shares) {
    return won ? shares - amount : -amount;
  }
  if (direction === "YES") {
    return won ? (amount * (1 - marketProb)) / marketProb : -amount;
  } else {
    return won ? (amount * marketProb) / (1 - marketProb) : -amount;
  }
}

/**
 * Compute unrealized P&L given current market probability.
 */
export function computeUnrealizedPnl(
  direction: "YES" | "NO",
  amount: number,
  entryProb: number,
  currentProb: number,
  shares?: number,
): number {
  if (shares) {
    return direction === "YES"
      ? shares * currentProb - amount
      : shares * (1 - currentProb) - amount;
  }
  if (direction === "YES") {
    return (amount * (currentProb - entryProb)) / entryProb;
  } else {
    return (amount * (entryProb - currentProb)) / (1 - entryProb);
  }
}

/**
 * Maximum possible payout (profit) on a position.
 */
export function computeMaxPayout(
  direction: "YES" | "NO",
  amount: number,
  entryProb: number,
  shares?: number,
): number {
  if (shares) {
    return shares - amount; // payout if market goes 100%/0%
  }
  if (direction === "YES") {
    return (amount * (1 - entryProb)) / entryProb;
  } else {
    return (amount * entryProb) / (1 - entryProb);
  }
}
