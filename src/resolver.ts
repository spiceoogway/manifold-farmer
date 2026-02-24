import type { TradeDecision, TradeExecution, Resolution, PositionSnapshot } from "./types.js";
import { readJsonl, DECISIONS_FILE, TRADES_FILE, RESOLUTIONS_FILE } from "./data.js";
import { getMarket } from "./manifold.js";
import { logResolution, logSnapshot, logInfo } from "./logger.js";

export async function runResolve(apiKey: string): Promise<void> {
  const trades = readJsonl<TradeExecution>(TRADES_FILE);
  const decisions = readJsonl<TradeDecision>(DECISIONS_FILE);
  const existing = readJsonl<Resolution>(RESOLUTIONS_FILE);

  // Only real executions (not dry-run, not errored)
  const realTrades = trades.filter(
    (t) => !t.dryRun && t.result?.betId && !t.result.error
  );

  const resolvedIds = new Set(existing.map((r) => r.traceId));
  const unresolved = realTrades.filter((t) => !resolvedIds.has(t.traceId));

  logInfo(`Found ${unresolved.length} unresolved bets to check`);

  if (unresolved.length === 0) {
    logInfo("Nothing to resolve.");
    return;
  }

  const decisionMap = new Map(decisions.map((d) => [d.traceId, d]));
  let resolved = 0;
  let skipped = 0;

  for (const trade of unresolved) {
    try {
      const market = await getMarket(apiKey, trade.marketId);

      if (!market.isResolved || !market.resolution) {
        skipped++;
        continue;
      }

      const resolution = market.resolution as "YES" | "NO" | "MKT" | "CANCEL";
      const decision = decisionMap.get(trade.traceId);

      if (resolution === "CANCEL") {
        const res: Resolution = {
          traceId: trade.traceId,
          resolvedAt: new Date().toISOString(),
          marketId: trade.marketId,
          question: trade.question,
          resolution: "CANCEL",
          direction: trade.direction,
          estimate: trade.estimate,
          marketProbAtBet: trade.marketProb,
          edge: trade.edge,
          confidence: decision?.confidence ?? "unknown",
          amount: trade.amount,
          won: false,
          pnl: 0,
          brierScore: 0,
          venue: trade.venue ?? "manifold",
        };
        logResolution(res);
        resolved++;
        continue;
      }

      const actual =
        resolution === "YES"
          ? 1
          : resolution === "NO"
            ? 0
            : market.resolutionProbability ?? 0.5;

      const won = computeWon(trade.direction, resolution, actual);
      const pnl = computePnl(
        trade.direction,
        trade.amount,
        trade.marketProb,
        resolution,
        won,
        trade.shares,
        market.resolutionProbability
      );
      const brierScore = (trade.estimate - actual) ** 2;

      const res: Resolution = {
        traceId: trade.traceId,
        resolvedAt: new Date().toISOString(),
        marketId: trade.marketId,
        question: trade.question,
        resolution,
        direction: trade.direction,
        estimate: trade.estimate,
        marketProbAtBet: trade.marketProb,
        edge: trade.edge,
        confidence: decision?.confidence ?? "unknown",
        amount: trade.amount,
        won,
        pnl,
        brierScore,
        venue: trade.venue ?? "manifold",
      };

      logResolution(res);
      resolved++;

      const symbol = won ? "+" : "-";
      logInfo(
        `  ${symbol} ${trade.question.slice(0, 60)} → ${resolution} | PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logInfo(`  ! Failed to check ${trade.marketId}: ${msg}`);
    }
  }

  logInfo(`\nResolved: ${resolved} | Still pending: ${skipped}`);

  // Record mid-market snapshots for all remaining open positions
  await recordSnapshots(apiKey);
}

function computeWon(
  direction: "YES" | "NO",
  resolution: "YES" | "NO" | "MKT",
  actual: number
): boolean {
  if (resolution === "MKT") {
    return direction === "YES" ? actual > 0.5 : actual < 0.5;
  }
  return direction === resolution;
}

function computePnl(
  direction: "YES" | "NO",
  amount: number,
  marketProb: number,
  resolution: "YES" | "NO" | "MKT",
  won: boolean,
  shares?: number,
  resolutionProbability?: number
): number {
  if (resolution === "MKT") {
    const p = resolutionProbability ?? 0.5;
    if (shares) {
      // Exact: shares × resolution value − cost
      return direction === "YES"
        ? shares * p - amount
        : shares * (1 - p) - amount;
    }
    // Fallback: approximate using market prob as fill price
    return direction === "YES"
      ? amount * (p - marketProb) / marketProb
      : amount * (marketProb - p) / (1 - marketProb);
  }

  // Binary YES/NO resolution
  if (shares) {
    // Exact: won shares pay $1 each, lost shares pay $0
    return won ? shares - amount : -amount;
  }
  // Fallback: approximate
  if (direction === "YES") {
    return won ? amount * (1 - marketProb) / marketProb : -amount;
  } else {
    return won ? amount * marketProb / (1 - marketProb) : -amount;
  }
}

/**
 * Record a mid-market snapshot for every open position.
 * Gives us mark-to-market calibration data between entry and resolution.
 */
async function recordSnapshots(apiKey: string): Promise<void> {
  const trades = readJsonl<TradeExecution>(TRADES_FILE);
  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  const resolvedIds = new Set(resolutions.map((r) => r.traceId));

  const openTrades = trades.filter(
    (t) => !t.dryRun && t.result?.betId && !t.result.error && !resolvedIds.has(t.traceId)
  );

  if (openTrades.length === 0) return;

  logInfo(`\nRecording snapshots for ${openTrades.length} open positions...`);
  let recorded = 0;

  for (const trade of openTrades) {
    try {
      const market = await getMarket(apiKey, trade.marketId);
      if (market.isResolved) continue; // just resolved, skip snapshot

      const currentProb = market.probability;
      let unrealizedPnl: number;

      if (trade.shares) {
        unrealizedPnl = trade.direction === "YES"
          ? trade.shares * currentProb - trade.amount
          : trade.shares * (1 - currentProb) - trade.amount;
      } else {
        unrealizedPnl = trade.direction === "YES"
          ? trade.amount * (currentProb - trade.marketProb) / trade.marketProb
          : trade.amount * (trade.marketProb - currentProb) / (1 - trade.marketProb);
      }

      const snapshot: PositionSnapshot = {
        timestamp: new Date().toISOString(),
        traceId: trade.traceId,
        marketId: trade.marketId,
        question: trade.question,
        direction: trade.direction,
        amount: trade.amount,
        estimate: trade.estimate,
        entryProb: trade.marketProb,
        currentProb,
        unrealizedPnl,
      };

      logSnapshot(snapshot);
      recorded++;
    } catch {
      // Non-critical — skip silently
    }
  }

  logInfo(`Recorded ${recorded} snapshots.`);
}
