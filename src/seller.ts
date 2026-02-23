/**
 * Sell command — checks open positions and sells those that have
 * reached target profit or where thesis is invalidated.
 */

import type { Config, TradeExecution, ManifoldMarket } from "./types.js";
import { readJsonl, TRADES_FILE, RESOLUTIONS_FILE } from "./data.js";
import { getMarket, sellShares } from "./manifold.js";
import { logInfo, logError } from "./logger.js";
import type { Resolution } from "./types.js";

interface Position {
  traceId: string;
  marketId: string;
  question: string;
  direction: "YES" | "NO";
  amount: number;
  shares?: number; // actual shares received — enables accurate fill-price P&L
  entryProb: number; // fallback when shares not available
  estimate: number;
  edge: number;
}

interface SellCandidate {
  position: Position;
  market: ManifoldMarket;
  currentProb: number;
  unrealizedPnl: number;
  maxPayout: number;
  payoutRatio: number; // unrealized / maxPayout
  reason: string;
}

/**
 * Find open positions from trades.jsonl that haven't resolved yet.
 */
function getOpenPositions(apiKey: string): Position[] {
  const trades = readJsonl<TradeExecution>(TRADES_FILE);
  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  const resolvedTraceIds = new Set(resolutions.map((r) => r.traceId));

  // Only real trades that haven't resolved
  return trades
    .filter((t) => !t.dryRun && !t.result?.error && !resolvedTraceIds.has(t.traceId))
    .map((t) => ({
      traceId: t.traceId,
      marketId: t.marketId,
      question: t.question,
      direction: t.direction,
      amount: t.amount,
      shares: t.shares,
      entryProb: t.marketProb,
      estimate: t.estimate,
      edge: t.edge,
    }));
}

/**
 * Run the sell analysis and optionally execute sells.
 */
export async function runSell(config: Config): Promise<void> {
  const positions = getOpenPositions(config.manifoldApiKey);

  if (positions.length === 0) {
    logInfo("No open positions to evaluate.");
    return;
  }

  logInfo(`Evaluating ${positions.length} open positions...`);

  const candidates: SellCandidate[] = [];

  for (const pos of positions) {
    try {
      const market = await getMarket(config.manifoldApiKey, pos.marketId);

      if (market.isResolved) {
        logInfo(`  ${pos.question.slice(0, 50)} — already resolved (${market.resolution}), skip sell`);
        continue;
      }

      const currentProb = market.probability;

      // Calculate unrealized P&L
      let unrealizedPnl: number;
      let maxPayout: number;

      if (pos.shares) {
        // Actual fill price: amount/shares per share
        if (pos.direction === "YES") {
          unrealizedPnl = pos.shares * currentProb - pos.amount;
          maxPayout = pos.shares - pos.amount; // if market goes to 100%
        } else {
          unrealizedPnl = pos.shares * (1 - currentProb) - pos.amount;
          maxPayout = pos.shares - pos.amount; // if market goes to 0%
        }
      } else {
        // Fallback: approximate using market prob at bet time as fill price
        if (pos.direction === "YES") {
          unrealizedPnl = pos.amount * (currentProb - pos.entryProb) / pos.entryProb;
          maxPayout = pos.amount * (1 - pos.entryProb) / pos.entryProb;
        } else {
          unrealizedPnl = pos.amount * (pos.entryProb - currentProb) / (1 - pos.entryProb);
          maxPayout = pos.amount * pos.entryProb / (1 - pos.entryProb);
        }
      }

      const payoutRatio = maxPayout > 0 ? unrealizedPnl / maxPayout : 0;

      // Determine if we should sell
      let reason = "";

      // Rule 1: Take profit — captured >70% of max payout
      if (payoutRatio >= 0.7) {
        reason = `TAKE_PROFIT: captured ${(payoutRatio * 100).toFixed(0)}% of max payout`;
      }

      // Rule 2: Market moved heavily against us — losing >50% of wager
      if (unrealizedPnl < -pos.amount * 0.5) {
        reason = `STOP_LOSS: losing ${((-unrealizedPnl / pos.amount) * 100).toFixed(0)}% of wager`;
      }

      // Rule 3: Market resolved to near-certainty against our position
      if (pos.direction === "YES" && currentProb < 0.05) {
        reason = `NEAR_CERTAIN_LOSS: market at ${(currentProb * 100).toFixed(1)}%, we're YES`;
      }
      if (pos.direction === "NO" && currentProb > 0.95) {
        reason = `NEAR_CERTAIN_LOSS: market at ${(currentProb * 100).toFixed(1)}%, we're NO`;
      }

      if (reason) {
        candidates.push({
          position: pos,
          market,
          currentProb,
          unrealizedPnl,
          maxPayout,
          payoutRatio,
          reason,
        });
      } else {
        const pnlStr = unrealizedPnl >= 0 ? `+M$${unrealizedPnl.toFixed(1)}` : `M$${unrealizedPnl.toFixed(1)}`;
        logInfo(
          `  HOLD: ${pos.question.slice(0, 50)} | ${pos.direction} M$${pos.amount} | ${pnlStr} (${(payoutRatio * 100).toFixed(0)}% of max)`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`  Error checking ${pos.marketId}: ${msg}`);
    }
  }

  if (candidates.length === 0) {
    logInfo("\nNo positions to sell.");
    return;
  }

  logInfo(`\n--- Sell Candidates ---`);
  for (const c of candidates) {
    const pnlStr = c.unrealizedPnl >= 0 ? `+M$${c.unrealizedPnl.toFixed(1)}` : `M$${c.unrealizedPnl.toFixed(1)}`;
    logInfo(
      `  SELL: ${c.position.question.slice(0, 50)} | ${c.position.direction} M$${c.position.amount} | ${pnlStr} | ${c.reason}`
    );
  }

  if (config.dryRun) {
    logInfo(`\n[DRY RUN] Would sell ${candidates.length} positions.`);
    return;
  }

  // Execute sells
  logInfo(`\nExecuting ${candidates.length} sells...`);
  let sold = 0;

  for (const c of candidates) {
    try {
      await sellShares(config.manifoldApiKey, c.position.marketId, c.position.direction);
      const pnlStr = c.unrealizedPnl >= 0 ? `+M$${c.unrealizedPnl.toFixed(1)}` : `M$${c.unrealizedPnl.toFixed(1)}`;
      logInfo(`  Sold ${c.position.direction} on ${c.position.question.slice(0, 50)} (${pnlStr}) — ${c.reason}`);
      sold++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`  Failed to sell ${c.position.marketId}: ${msg}`);
    }
  }

  logInfo(`\nSold ${sold}/${candidates.length} positions.`);
}
