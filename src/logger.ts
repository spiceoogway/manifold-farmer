import { appendFileSync } from "fs";
import { DECISIONS_FILE, TRADES_FILE, RESOLUTIONS_FILE } from "./data.js";
import type { TradeDecision, TradeExecution, Resolution } from "./types.js";

function appendJsonl(file: string, data: unknown): void {
  appendFileSync(file, JSON.stringify(data) + "\n");
}

export function logDecision(decision: TradeDecision): void {
  appendJsonl(DECISIONS_FILE, decision);

  const symbol = decision.action === "BET" ? ">>>" : "---";
  const edgePct = (decision.edge * 100).toFixed(1);
  const estPct = (decision.estimate * 100).toFixed(0);
  const mktPct = (decision.marketProb * 100).toFixed(0);

  console.log(
    `  ${symbol} ${decision.question.slice(0, 70)}`
  );
  console.log(
    `      Est: ${estPct}% | Mkt: ${mktPct}% | Edge: ${edgePct}% | ${decision.action}${
      decision.action === "BET"
        ? ` → ${decision.direction} M$${decision.betAmount.toFixed(0)}`
        : ""
    }`
  );
}

export function logTrade(trade: TradeExecution): void {
  appendJsonl(TRADES_FILE, trade);
}

export function logResolution(resolution: Resolution): void {
  appendJsonl(RESOLUTIONS_FILE, resolution);
}

export function logInfo(msg: string): void {
  console.log(`[info] ${msg}`);
}

export function logError(msg: string): void {
  console.error(`[error] ${msg}`);
}
