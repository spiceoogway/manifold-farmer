import type { Config, TradeDecision, TradeExecution } from "./types.js";
import { placeBet } from "./manifold.js";
import { createClobClient, placePolyOrder } from "./polymarket.js";
import { logTrade, logInfo, logError } from "./logger.js";

export async function executeBets(
  decisions: TradeDecision[],
  config: Config
): Promise<TradeExecution[]> {
  const bets = decisions.filter((d) => d.action === "BET" && d.direction);
  const executions: TradeExecution[] = [];

  // Lazily create CLOB client only if we have Polymarket bets
  let clobClient: Awaited<ReturnType<typeof createClobClient>> | undefined;

  for (const decision of bets) {
    const venue = decision.venue ?? "manifold";
    const currencyLabel = venue === "polymarket" ? "$" : "M$";

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
      venue,
      polyTokenId: decision.polyTokenId,
    };

    if (config.dryRun) {
      logInfo(
        `[DRY RUN] Would bet ${currencyLabel}${decision.betAmount} on ${decision.direction} for: ${decision.question.slice(0, 60)}`
      );
      execution.result = { betId: "dry-run" };
    } else if (venue === "polymarket") {
      try {
        if (!decision.polyTokenId) {
          throw new Error("Missing polyTokenId for Polymarket order");
        }
        if (!clobClient) {
          clobClient = await createClobClient(config);
        }
        const price = decision.direction === "YES" ? decision.marketProb : 1 - decision.marketProb;
        const result = await placePolyOrder(
          clobClient,
          decision.polyTokenId,
          "BUY",
          decision.betAmount,
          price,
        );
        if ("error" in result) {
          execution.result = { error: result.error };
          logError(`Failed Polymarket order: ${decision.question.slice(0, 60)}: ${result.error}`);
        } else {
          execution.result = { orderId: result.orderId };
          logInfo(
            `Placed $${decision.betAmount} on ${decision.direction} — ${decision.question.slice(0, 60)} (order: ${result.orderId})`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        execution.result = { error: msg };
        logError(`Failed Polymarket order: ${decision.question.slice(0, 60)}: ${msg}`);
      }
    } else {
      // Manifold
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
