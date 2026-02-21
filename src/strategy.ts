import { randomUUID } from "crypto";
import type { Config, ManifoldMarket, ClaudeEstimate, TradeDecision } from "./types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * ONE_HOUR_MS;

/**
 * Filter markets suitable for analysis.
 * - Binary CPMM markets only
 * - Liquidity above threshold
 * - Closes between 1 hour and 90 days from now
 * - Has at least 1 bettor
 * - Not already resolved
 */
export function filterMarkets(
  markets: ManifoldMarket[],
  config: Config
): ManifoldMarket[] {
  const now = Date.now();
  return markets.filter((m) => {
    if (m.outcomeType !== "BINARY") return false;
    if (m.isResolved) return false;
    if (m.totalLiquidity < config.minLiquidity) return false;

    const timeToClose = m.closeTime - now;
    if (timeToClose < ONE_HOUR_MS) return false;
    if (timeToClose > NINETY_DAYS_MS) return false;

    if ((m.uniqueBettorCount ?? 0) < 1) return false;

    return true;
  });
}

/**
 * Calculate edge between our estimate and the market.
 */
export function calculateEdge(estimate: number, marketProb: number): number {
  return Math.abs(estimate - marketProb);
}

/**
 * Determine bet direction.
 */
export function getDirection(
  estimate: number,
  marketProb: number
): "YES" | "NO" {
  return estimate > marketProb ? "YES" : "NO";
}

/**
 * Full Kelly fraction for a bet.
 *
 * Betting YES at market price m:
 *   b = (1 - m) / m   (net odds)
 *   f* = (b * p - q) / b
 *
 * Betting NO at market price m:
 *   b = m / (1 - m)   (net odds)
 *   p_no = 1 - estimate
 *   f* = (b * p_no - (1 - p_no)) / b
 */
export function kellyFraction(
  estimate: number,
  marketProb: number,
  direction: "YES" | "NO"
): number {
  let b: number;
  let p: number;

  if (direction === "YES") {
    b = (1 - marketProb) / marketProb;
    p = estimate;
  } else {
    b = marketProb / (1 - marketProb);
    p = 1 - estimate;
  }

  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

/**
 * Size a bet using fractional Kelly with position and liquidity limits.
 */
export function sizeBet(
  fullKelly: number,
  bankroll: number,
  liquidity: number,
  config: Config
): number {
  // Apply Kelly fraction (e.g., 1/4 Kelly)
  let bet = fullKelly * config.kellyFraction * bankroll;

  // Cap at max position percentage
  bet = Math.min(bet, bankroll * config.maxPositionPct);

  // Cap at max bet amount
  bet = Math.min(bet, config.maxBetAmount);

  // Cap at percentage of pool liquidity to limit price impact
  // Price impact ≈ bet / (2 * liquidity), so cap bet at maxImpactPct * 2 * liquidity
  bet = Math.min(bet, config.maxImpactPct * 2 * liquidity);

  // Floor at 1 mana (minimum bet)
  return Math.max(0, Math.round(bet));
}

/**
 * Analyze a market and produce a trade decision.
 */
export function makeDecision(
  market: ManifoldMarket,
  estimate: ClaudeEstimate,
  bankroll: number,
  config: Config
): TradeDecision {
  const edge = calculateEdge(estimate.probability, market.probability);
  const traceId = randomUUID();
  const base: Omit<TradeDecision, "action" | "direction" | "kellyFraction" | "betAmount"> = {
    traceId,
    timestamp: new Date().toISOString(),
    marketId: market.id,
    question: market.question,
    marketUrl: market.url,
    marketProb: market.probability,
    estimate: estimate.probability,
    confidence: estimate.confidence,
    reasoning: estimate.reasoning,
    edge,
  };

  if (edge < config.edgeThreshold) {
    return {
      ...base,
      direction: null,
      kellyFraction: 0,
      betAmount: 0,
      action: "SKIP_LOW_EDGE",
    };
  }

  const direction = getDirection(estimate.probability, market.probability);
  const fKelly = kellyFraction(estimate.probability, market.probability, direction);

  if (fKelly <= 0) {
    return {
      ...base,
      direction,
      kellyFraction: fKelly,
      betAmount: 0,
      action: "SKIP_NEGATIVE_KELLY",
    };
  }

  const betAmount = sizeBet(fKelly, bankroll, market.totalLiquidity, config);

  if (betAmount < 1) {
    return {
      ...base,
      direction,
      kellyFraction: fKelly,
      betAmount: 0,
      action: "SKIP_LOW_EDGE",
    };
  }

  return {
    ...base,
    direction,
    kellyFraction: fKelly,
    betAmount,
    action: "BET",
  };
}
