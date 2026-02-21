import type { TradeDecision, TradeExecution, Resolution } from "./types.js";
import { readJsonl, DECISIONS_FILE, TRADES_FILE, RESOLUTIONS_FILE } from "./data.js";
import { getMarket } from "./manifold.js";
import { logResolution, logInfo } from "./logger.js";

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
        won
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
  won: boolean
): number {
  // For MKT resolution, approximate based on resolution probability
  if (resolution === "MKT") {
    // Simplified: treat as partial win/loss
    return won ? amount * 0.1 : -amount * 0.1;
  }

  if (direction === "YES") {
    return won ? amount * (1 - marketProb) / marketProb : -amount;
  } else {
    return won ? amount * marketProb / (1 - marketProb) : -amount;
  }
}
