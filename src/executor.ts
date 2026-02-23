import type { Config, TradeDecision, TradeExecution } from "./types.js";
import { placeBet } from "./manifold.js";
import { logTrade, logInfo, logError } from "./logger.js";

export async function executeBets(
  decisions: TradeDecision[],
  config: Config
): Promise<TradeExecution[]> {
  const bets = decisions.filter((d) => d.action === "BET" && d.direction);
  const executions: TradeExecution[] = [];

  for (const decision of bets) {
    const execution: TradeExecution = {
      traceId: decision.traceId,
      timestamp: new Date().toISOString(),
      marketId: decision.marketId,
      question: decision.question,
      direction: decision.direction!,
      amount: decision.betAmount,
      marketProb: decision.marketProb,
      estimate: decision.estimate,
      edge: decision.edge,
      dryRun: config.dryRun,
    };

    if (config.dryRun) {
      logInfo(
        `[DRY RUN] Would bet M$${decision.betAmount} on ${decision.direction} for: ${decision.question.slice(0, 60)}`
      );
      execution.result = { betId: "dry-run" };
    } else {
      try {
        const result = await placeBet(
          config.manifoldApiKey,
          decision.marketId,
          decision.direction!,
          decision.betAmount
        );
        execution.result = { betId: result.betId };
        execution.shares = result.shares;
        logInfo(
          `Placed M$${decision.betAmount} on ${decision.direction} — ${decision.question.slice(0, 60)} (bet: ${result.betId})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        execution.result = { error: msg };
        logError(`Failed to bet on ${decision.question.slice(0, 60)}: ${msg}`);
      }
    }

    logTrade(execution);
    executions.push(execution);
  }

  return executions;
}
