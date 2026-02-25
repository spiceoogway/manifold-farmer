/**
 * Resolution tracking for Polymarket positions.
 *
 * Resolution detection reads directly from the Gnosis Conditional Token
 * Framework (CTF) contract on Polygon:
 *   - payoutDenominator(conditionId) > 0  → market resolved
 *   - payoutNumerators(conditionId, 0) > 0 → YES won (outcome index 0)
 *   - payoutNumerators(conditionId, 1) > 0 → NO won  (outcome index 1)
 *
 * This is the authoritative source — the same data the CTF uses when
 * redeemPositions() is called.
 */

import { ethers } from "ethers";
import type { TradeDecision, TradeExecution, Resolution } from "./types.js";
import { readJsonl, DECISIONS_FILE, TRADES_FILE, RESOLUTIONS_FILE } from "./data.js";
import { logInfo, logResolution } from "./logger.js";

// Polygon mainnet — from @polymarket/clob-client config.js
const POLYGON_RPC = "https://polygon-rpc.com";
const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

const CTF_ABI = [
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 index) view returns (uint256)",
];

type ResolutionStatus =
  | { resolved: false }
  | { resolved: true; winner: "YES" | "NO" };

async function checkConditionResolution(
  ctf: ethers.Contract,
  conditionId: string
): Promise<ResolutionStatus> {
  const denom: ethers.BigNumber = await ctf.payoutDenominator(conditionId);
  if (denom.isZero()) return { resolved: false };

  const [yes, no]: [ethers.BigNumber, ethers.BigNumber] = await Promise.all([
    ctf.payoutNumerators(conditionId, 0),
    ctf.payoutNumerators(conditionId, 1),
  ]);

  // In Polymarket binary markets: index 0 = YES, index 1 = NO
  const winner = yes.gt(no) ? "YES" : "NO";
  return { resolved: true, winner };
}

function computePolyPnl(trade: TradeExecution, won: boolean): number {
  // We spent `amount` USDC at `marketProb` per share (effective fill price).
  // shares = amount / marketProb
  // Win: each share pays $1 → payout = shares = amount / marketProb
  // Lose: payout = $0
  if (won) {
    const shares = trade.amount / trade.marketProb;
    return shares - trade.amount; // payout - cost
  }
  return -trade.amount;
}

export async function runPolyResolve(): Promise<void> {
  const trades = readJsonl<TradeExecution>(TRADES_FILE);
  const decisions = readJsonl<TradeDecision>(DECISIONS_FILE);
  const existing = readJsonl<Resolution>(RESOLUTIONS_FILE);

  const resolvedIds = new Set(existing.map(r => r.traceId));

  // Only real, unfailed, unresolved Polymarket executions
  const unresolved = trades.filter(t =>
    t.venue === "polymarket" &&
    !t.dryRun &&
    !t.result?.error &&
    !resolvedIds.has(t.traceId)
  );

  if (unresolved.length === 0) {
    logInfo("No unresolved Polymarket bets.");
    return;
  }

  logInfo(`Checking ${unresolved.length} unresolved Polymarket bets on-chain...`);

  const provider = new ethers.providers.JsonRpcProvider(POLYGON_RPC);
  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, provider);
  const decisionMap = new Map(decisions.map(d => [d.traceId, d]));

  let resolved = 0;
  let pending = 0;

  // Deduplicate conditionIds to avoid redundant RPC calls
  const conditionCache = new Map<string, ResolutionStatus>();

  for (const trade of unresolved) {
    try {
      let status = conditionCache.get(trade.marketId);
      if (!status) {
        status = await checkConditionResolution(ctf, trade.marketId);
        conditionCache.set(trade.marketId, status);
      }

      if (!status.resolved) {
        pending++;
        continue;
      }

      const winner = status.winner;
      const won = trade.direction === winner;
      const pnl = computePolyPnl(trade, won);
      const actual = winner === "YES" ? 1 : 0;
      const brierScore = (trade.estimate - actual) ** 2;
      const decision = decisionMap.get(trade.traceId);

      const res: Resolution = {
        traceId: trade.traceId,
        resolvedAt: new Date().toISOString(),
        marketId: trade.marketId,
        question: trade.question,
        resolution: winner,
        direction: trade.direction,
        estimate: trade.estimate,
        marketProbAtBet: trade.marketProb,
        edge: trade.edge,
        confidence: decision?.confidence ?? "unknown",
        amount: trade.amount,
        won,
        pnl,
        brierScore,
        venue: "polymarket",
      };

      logResolution(res);
      resolved++;

      const symbol = won ? "+" : "-";
      logInfo(
        `  ${symbol} ${trade.question.slice(0, 60)} → ${winner} | PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logInfo(`  ! Failed to check ${trade.marketId}: ${msg}`);
    }
  }

  logInfo(`\nPolymarket resolved: ${resolved} | Still pending: ${pending}`);
}
