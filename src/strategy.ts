import { randomUUID } from "crypto";
import type { Config, ManifoldMarket, ClaudeEstimate, TradeDecision } from "./types.js";
import type { PolymarketMarket } from "./polymarket.js";
import { isFinanceMarket } from "./finance-tool.js";
import { isSportsMarket } from "./sports-tool.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * 24 * ONE_HOUR_MS;

// Patterns that indicate a market resolves quickly (hours to days)
const FAST_RESOLUTION_PATTERNS: RegExp[] = [
  /\bNBA\b.*beat/i,
  /\bNHL\b.*beat/i,
  /\bNFL\b.*beat|win/i,
  /\bMLB\b.*beat/i,
  /\bUFC\b/i,
  /\bstock.*close|close.*stock|stock.*price.*(?:on|by)\b/i,
  /\bcoin\s?flip/i,
  /\bdaily\b/i,
  /\bby (?:end of |eod |EOD)?\w+ \d{1,2}(?:st|nd|rd|th)?\b/i,   // "by Feb 28th"
  /\bbefore (?:end of )?\w+ \d{1,2}/i,                             // "before March 1"
  /\bearning|revenue|eps\b.*(?:Q[1-4]|quarter)/i,                  // earnings reports
  /\bgold\b.*(?:above|below|end of)/i,                             // commodity targets
];

/**
 * Score how quickly a market is likely to resolve.
 * Higher score = faster resolution = better for training loop.
 *
 * Factors:
 * - Close time proximity (closer = faster resolution)
 * - Pattern matching (sports, daily, earnings = fast)
 * - Bettor count (more bettors on short markets = more liquid)
 */
export function resolutionSpeedScore(market: ManifoldMarket): number {
  const now = Date.now();
  const timeToClose = market.closeTime - now;

  // Base score from time to close (0-50 points)
  // Markets closing within 7 days get max score, decays linearly to 0 at 90 days
  let timeScore = 0;
  if (timeToClose <= SEVEN_DAYS_MS) {
    timeScore = 50;
  } else if (timeToClose <= NINETY_DAYS_MS) {
    timeScore = 50 * (1 - (timeToClose - SEVEN_DAYS_MS) / (NINETY_DAYS_MS - SEVEN_DAYS_MS));
  }

  // Pattern bonus (0-30 points) for markets with predictable resolution dates
  const patternMatch = FAST_RESOLUTION_PATTERNS.some((p) => p.test(market.question));
  const patternScore = patternMatch ? 30 : 0;

  // Liquidity score (0-20 points) — prefer markets with enough liquidity to bet meaningfully
  const liqScore = Math.min(20, (market.totalLiquidity / 5000) * 20);

  return timeScore + patternScore + liqScore;
}

/**
 * Filter markets suitable for analysis, sorted by resolution speed.
 * - Binary CPMM markets only
 * - Liquidity above threshold
 * - Closes between 1 hour and 90 days from now
 * - Has at least 1 bettor
 * - Not already resolved
 *
 * Returns results sorted by resolution speed (fastest first).
 */
export function filterMarkets(
  markets: ManifoldMarket[],
  config: Config
): ManifoldMarket[] {
  const now = Date.now();
  const filtered = markets.filter((m) => {
    if (m.outcomeType !== "BINARY") return false;
    if (m.isResolved) return false;
    if (m.totalLiquidity < config.minLiquidity) return false;

    const timeToClose = m.closeTime - now;
    if (timeToClose < ONE_HOUR_MS) return false;
    if (timeToClose > NINETY_DAYS_MS) return false;

    if ((m.uniqueBettorCount ?? 0) < 1) return false;

    return true;
  });

  // Sort by resolution speed score (highest first)
  return filtered.sort((a, b) => resolutionSpeedScore(b) - resolutionSpeedScore(a));
}

/**
 * Calculate edge between our estimate and the market.
 */
function calculateEdge(estimate: number, marketProb: number): number {
  return Math.abs(estimate - marketProb);
}

/**
 * Determine bet direction.
 */
function getDirection(
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
function kellyFraction(
  estimate: number,
  marketProb: number,
  direction: "YES" | "NO"
): number {
  const clampedProb = Math.min(0.99, Math.max(0.01, marketProb));
  let b: number;
  let p: number;

  if (direction === "YES") {
    b = (1 - clampedProb) / clampedProb;
    p = estimate;
  } else {
    b = clampedProb / (1 - clampedProb);
    p = 1 - estimate;
  }

  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

/**
 * Size a bet using fractional Kelly with position limits.
 */
function sizeBet(
  fullKelly: number,
  bankroll: number,
  config: Config
): number {
  // Apply Kelly fraction (e.g., 1/4 Kelly)
  let bet = fullKelly * config.kellyFraction * bankroll;

  // Cap at max position percentage
  bet = Math.min(bet, bankroll * config.maxPositionPct);

  // Cap at max bet amount
  bet = Math.min(bet, config.maxBetAmount);

  // Floor at 1 mana (minimum bet)
  return Math.max(0, Math.round(bet));
}

/**
 * Iteratively solve for optimal bet size accounting for AMM slippage.
 *
 * Slippage worsens our effective fill price, reducing edge and Kelly fraction.
 * We iterate: guess bet size → compute slippage-adjusted price → recompute Kelly
 * → re-size → converge in ~5 iterations.
 *
 * Price impact approximation for CPMM: buying amount A shifts the effective
 * average fill price by ~A / (4 * liquidity) against us.
 */
function sizeBetWithSlippage(
  estimate: number,
  marketProb: number,
  direction: "YES" | "NO",
  bankroll: number,
  liquidity: number,
  config: Config
): { betAmount: number; kellyFrac: number; effectiveProb: number } {
  let bet = 0;
  let fKelly = 0;
  let adjProb = marketProb;

  for (let i = 0; i < 8; i++) {
    // Adjust market prob for slippage: buying pushes price against us
    const slippage = bet / (4 * liquidity);
    if (direction === "YES") {
      adjProb = Math.min(0.99, marketProb + slippage);
    } else {
      adjProb = Math.max(0.01, marketProb - slippage);
    }

    // Recompute Kelly at the slippage-adjusted price
    fKelly = kellyFraction(estimate, adjProb, direction);
    if (fKelly <= 0) return { betAmount: 0, kellyFrac: 0, effectiveProb: adjProb };

    // Size with standard constraints
    const newBet = sizeBet(fKelly, bankroll, config);
    if (Math.abs(newBet - bet) < 1) break; // converged
    bet = newBet;
  }

  return { betAmount: bet, kellyFrac: fKelly, effectiveProb: adjProb };
}

/**
 * Convert a Polymarket market to the ManifoldMarket shape for reuse in makeDecision/analyzer.
 */
export function polyToManifoldLike(poly: PolymarketMarket): ManifoldMarket {
  return {
    id: poly.conditionId,
    question: poly.question,
    url: `https://polymarket.com/event/${poly.slug}`,
    probability: poly.yesPrice,
    totalLiquidity: poly.liquidity,
    volume: poly.volume24hr,
    closeTime: poly.endDate.getTime(),
    createdTime: 0,
    outcomeType: "BINARY",
    mechanism: "clob",
    isResolved: false,
    creatorUsername: "polymarket",
    uniqueBettorCount: 0,
  };
}

/**
 * Analyze a market and produce a trade decision.
 */
export function makeDecision(
  market: ManifoldMarket,
  estimate: ClaudeEstimate,
  bankroll: number,
  config: Config,
  options?: { venue?: "manifold" | "polymarket" }
): TradeDecision {
  const venue = options?.venue ?? "manifold";
  const edge = calculateEdge(estimate.probability, market.probability);
  const traceId = randomUUID();

  // Extract text description for logging
  let desc = "";
  if (market.textDescription) desc = market.textDescription;
  else if (typeof market.description === "string") desc = market.description;

  const base: Omit<TradeDecision, "action" | "direction" | "kellyFraction" | "effectiveProb" | "betAmount"> = {
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
    venue,
    liquidity: market.totalLiquidity,
    closeTime: new Date(market.closeTime).toISOString(),
    uniqueBettorCount: market.uniqueBettorCount ?? 0,
    description: desc.slice(0, 2000),
  };

  if (edge < config.edgeThreshold) {
    return {
      ...base,
      direction: null,
      kellyFraction: 0,
      effectiveProb: market.probability,
      betAmount: 0,
      action: "SKIP_LOW_EDGE",
    };
  }

  // Skip low-confidence bets unless we have a data tool for this category
  if (estimate.confidence === "low") {
    const hasDataTool = isFinanceMarket(market.question) || isSportsMarket(market.question);
    if (!hasDataTool) {
      return {
        ...base,
        direction: null,
        kellyFraction: 0,
        effectiveProb: market.probability,
        betAmount: 0,
        action: "SKIP_LOW_CONFIDENCE",
      };
    }
  }

  const direction = getDirection(estimate.probability, market.probability);

  let betAmount: number;
  let kellyFrac: number;
  let effectiveProb: number;

  if (venue === "polymarket") {
    // CLOB: no AMM slippage — plain Kelly sizing
    kellyFrac = kellyFraction(estimate.probability, market.probability, direction);
    effectiveProb = market.probability;
    betAmount = kellyFrac > 0 ? sizeBet(kellyFrac, bankroll, config) : 0;
    // Apply Polymarket-specific cap
    betAmount = Math.min(betAmount, config.polyMaxBetAmount);
  } else {
    // AMM: iterative Kelly with slippage
    const result = sizeBetWithSlippage(
      estimate.probability,
      market.probability,
      direction,
      bankroll,
      market.totalLiquidity,
      config
    );
    betAmount = result.betAmount;
    kellyFrac = result.kellyFrac;
    effectiveProb = result.effectiveProb;
  }

  if (kellyFrac <= 0) {
    return {
      ...base,
      direction,
      kellyFraction: kellyFrac,
      effectiveProb,
      betAmount: 0,
      action: "SKIP_NEGATIVE_KELLY",
    };
  }

  if (betAmount < 1) {
    return {
      ...base,
      direction,
      kellyFraction: kellyFrac,
      effectiveProb,
      betAmount: 0,
      action: "SKIP_LOW_EDGE",
    };
  }

  return {
    ...base,
    direction,
    kellyFraction: kellyFrac,
    effectiveProb,
    betAmount,
    action: "BET",
  };
}
