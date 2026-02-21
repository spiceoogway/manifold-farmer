import { loadConfig } from "./config.js";
import { getMarket } from "./manifold.js";
import { readJsonl, TRADES_FILE } from "./data.js";
import type { TradeExecution } from "./types.js";

async function main() {
  const config = loadConfig();
  const trades = readJsonl<TradeExecution>(TRADES_FILE);

  // Get only real (non-dry-run) trades
  const real = trades.filter((t) => !t.dryRun && t.result?.betId && !t.result.error);

  console.log(`\n=== Portfolio Status (${real.length} live bets) ===\n`);

  let totalDeployed = 0;
  let unrealizedPnl = 0;

  for (const trade of real) {
    try {
      const market = await getMarket(config.manifoldApiKey, trade.marketId);
      const currentProb = market.probability;
      const status = market.isResolved
        ? `RESOLVED: ${market.resolution}`
        : `${(currentProb * 100).toFixed(0)}%`;

      // Estimate unrealized P&L based on probability movement
      const probAtBet = trade.marketProb;
      let pnlEstimate: number;
      if (market.isResolved) {
        const resolution = market.resolution as string;
        if (resolution === "CANCEL") {
          pnlEstimate = 0;
        } else if (trade.direction === resolution) {
          pnlEstimate = trade.direction === "YES"
            ? trade.amount * (1 - probAtBet) / probAtBet
            : trade.amount * probAtBet / (1 - probAtBet);
        } else {
          pnlEstimate = -trade.amount;
        }
      } else {
        // Unrealized: estimate based on prob movement toward/away from our bet
        if (trade.direction === "YES") {
          pnlEstimate = trade.amount * (currentProb - probAtBet) / probAtBet;
        } else {
          pnlEstimate = trade.amount * (probAtBet - currentProb) / (1 - probAtBet);
        }
      }

      const pnlSign = pnlEstimate >= 0 ? "+" : "";
      const arrow = pnlEstimate >= 0 ? "▲" : "▼";
      const resolvedTag = market.isResolved ? ` [${market.resolution}]` : "";

      console.log(`${arrow} ${trade.direction} M$${trade.amount} | ${trade.question.slice(0, 55)}`);
      console.log(`    Bet@${(probAtBet * 100).toFixed(0)}% → Now ${status}${resolvedTag} | Est P&L: ${pnlSign}M$${pnlEstimate.toFixed(1)}`);
      console.log();

      totalDeployed += trade.amount;
      unrealizedPnl += pnlEstimate;
    } catch (err) {
      console.log(`? ${trade.question.slice(0, 60)} — failed to fetch`);
    }
  }

  const pnlSign = unrealizedPnl >= 0 ? "+" : "";
  console.log(`--- Totals ---`);
  console.log(`Deployed: M$${totalDeployed}`);
  console.log(`Est. P&L: ${pnlSign}M$${unrealizedPnl.toFixed(1)}`);
}

main();
