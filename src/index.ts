import { loadConfig } from "./config.js";
import { getMe, searchMarkets, getMarket } from "./manifold.js";
import { estimateProbability } from "./analyzer.js";
import { filterMarkets, makeDecision, polyToManifoldLike } from "./strategy.js";
import { executeBets } from "./executor.js";
import { logDecision, logInfo, logError } from "./logger.js";
import { readJsonl, RESOLUTIONS_FILE, TRADES_FILE, SNAPSHOTS_FILE } from "./data.js";
import { runResolve } from "./resolver.js";
import { computeCalibration } from "./calibration.js";
import { formatFeedback } from "./feedback.js";
import { runSell } from "./seller.js";
import { fetchPolymarketMarkets, filterPolymarketMarkets, enrichWithEffectivePrices, redeemPolyPosition } from "./polymarket.js";
import { runPolyResolve } from "./poly-resolver.js";
import type { TradeDecision, TradeExecution, Resolution, PositionSnapshot } from "./types.js";

async function runPolyScan() {
  const config = loadConfig();
  logInfo(`Polymarket scan — ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  logInfo(`Model: ${config.claudeModel}`);
  logInfo(`Edge threshold: ${(config.edgeThreshold * 100).toFixed(0)}%`);

  // Load calibration feedback
  let calibrationFeedback: string | undefined;
  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  if (resolutions.length > 0) {
    const report = computeCalibration(resolutions);
    const feedback = formatFeedback(report);
    if (feedback) {
      calibrationFeedback = feedback;
      logInfo(`Loaded calibration feedback from ${resolutions.length} resolved bets`);
    }
  }

  // 1. Fetch and filter Polymarket markets
  logInfo("Fetching Polymarket markets...");
  const polyMarkets = await fetchPolymarketMarkets(config);
  const filtered = filterPolymarketMarkets(polyMarkets);
  logInfo(`Fetched ${polyMarkets.length} markets, ${filtered.length} pass filters`);

  // 2. Exclude already-held positions
  const allTrades = readJsonl<TradeExecution>(TRADES_FILE);
  const resolvedTraceIds = new Set(resolutions.map(r => r.traceId));
  const heldConditionIds = new Set(
    allTrades
      .filter(t => t.venue === "polymarket" && !t.dryRun && !t.result?.error && !resolvedTraceIds.has(t.traceId))
      .map(t => t.marketId)
  );
  const candidates = filtered.filter(m => !heldConditionIds.has(m.conditionId));
  if (heldConditionIds.size > 0) {
    logInfo(`Skipping ${heldConditionIds.size} markets with existing positions`);
  }

  // 3. Enrich with effective fill prices from CLOB orderbooks
  const preCandidates = candidates.slice(0, config.polyMaxMarketsPerRun * 2);
  logInfo(`Fetching orderbook depth for ${preCandidates.length} markets...`);
  const priced = await enrichWithEffectivePrices(preCandidates, config.polyMaxBetAmount);
  const toAnalyze = priced.slice(0, config.polyMaxMarketsPerRun);
  logInfo(`${priced.length}/${preCandidates.length} markets have fillable depth — analyzing ${toAnalyze.length} with Claude...\n`);

  const decisions: TradeDecision[] = [];
  const bankroll = config.polyMaxBetAmount * 10;

  for (const poly of toAnalyze) {
    try {
      const marketLike = polyToManifoldLike(poly);
      const estimate = await estimateProbability(config, marketLike, calibrationFeedback);
      const decision = makeDecision(marketLike, estimate, bankroll, config, { venue: "polymarket" });

      // Attach Polymarket-specific fields
      decision.polyTokenId = decision.direction === "YES" ? poly.yesTokenId : poly.noTokenId;

      logDecision(decision);
      decisions.push(decision);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Failed to analyze ${poly.question.slice(0, 60)}: ${msg}`);
    }
  }

  // 4. Execute
  const bets = decisions.filter(d => d.action === "BET");
  logInfo(`\n--- Summary ---`);
  logInfo(`Analyzed: ${decisions.length}`);
  logInfo(`Bets identified: ${bets.length}`);

  if (bets.length > 0) {
    const executions = await executeBets(decisions, config);
    const ok = executions.filter(e => !e.result?.error);
    logInfo(`Bets executed: ${ok.length}/${executions.length}`);
  } else {
    logInfo("No bets to place this run.");
  }

  logInfo("Done.");
}

async function runScan() {
  const config = loadConfig();
  logInfo(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  logInfo(`Model: ${config.claudeModel}`);
  logInfo(`Edge threshold: ${(config.edgeThreshold * 100).toFixed(0)}%`);

  // Load calibration feedback
  let calibrationFeedback: string | undefined;
  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  if (resolutions.length > 0) {
    const report = computeCalibration(resolutions);
    const feedback = formatFeedback(report);
    if (feedback) {
      calibrationFeedback = feedback;
      logInfo(`Loaded calibration feedback from ${resolutions.length} resolved bets`);
    }
  }

  const me = await getMe(config.manifoldApiKey);
  const bankroll = me.balance;
  logInfo(`User: ${me.username} | Balance: M$${bankroll.toFixed(0)}`);

  if (bankroll < 10) {
    logError("Balance too low to trade. Exiting.");
    process.exit(1);
  }

  // Build set of market IDs we already hold positions in
  const allTrades = readJsonl<TradeExecution>(TRADES_FILE);
  const allResolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  const resolvedTraceIds = new Set(allResolutions.map((r) => r.traceId));
  const heldMarketIds = new Set(
    allTrades
      .filter((t) => !t.dryRun && !t.result?.error && !resolvedTraceIds.has(t.traceId))
      .map((t) => t.marketId)
  );
  if (heldMarketIds.size > 0) {
    logInfo(`Skipping ${heldMarketIds.size} markets with existing positions`);
  }

  logInfo("Searching for markets...");
  const rawMarkets = await searchMarkets(config.manifoldApiKey, 50);
  logInfo(`Fetched ${rawMarkets.length} markets`);

  const candidates = filterMarkets(rawMarkets, config)
    .filter((m) => !heldMarketIds.has(m.id));
  logInfo(`${candidates.length} markets pass filters (excl. held positions)`);

  const toAnalyze = candidates.slice(0, config.maxMarketsPerRun);
  logInfo(`Analyzing ${toAnalyze.length} markets with Claude...\n`);

  const decisions: TradeDecision[] = [];

  for (const lite of toAnalyze) {
    try {
      const market = await getMarket(config.manifoldApiKey, lite.id);
      const estimate = await estimateProbability(config, market, calibrationFeedback);
      const decision = makeDecision(market, estimate, bankroll, config);

      logDecision(decision);
      decisions.push(decision);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Failed to analyze market ${lite.id}: ${msg}`);
      decisions.push({
        traceId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        marketId: lite.id,
        question: lite.question,
        marketUrl: lite.url,
        marketProb: lite.probability,
        estimate: 0,
        confidence: "low",
        reasoning: `Error: ${msg}`,
        edge: 0,
        direction: null,
        kellyFraction: 0,
        venue: "manifold",
        effectiveProb: lite.probability,
        betAmount: 0,
        action: "SKIP_ERROR",
        liquidity: lite.totalLiquidity,
        closeTime: new Date(lite.closeTime).toISOString(),
        uniqueBettorCount: lite.uniqueBettorCount ?? 0,
        description: "",
      });
    }
  }

  const betsToPlace = decisions.filter((d) => d.action === "BET");
  logInfo(`\n--- Summary ---`);
  logInfo(`Analyzed: ${decisions.length}`);
  logInfo(`Bets identified: ${betsToPlace.length}`);

  if (betsToPlace.length > 0) {
    const executions = await executeBets(decisions, config);
    const successful = executions.filter((e) => !e.result?.error);
    logInfo(`Bets executed: ${successful.length}/${executions.length}`);
  } else {
    logInfo("No bets to place this run.");
  }

  logInfo("Done.");
}

async function runResolveCmd() {
  const config = loadConfig();
  logInfo("Checking unresolved bets...");
  await runResolve(config.manifoldApiKey);
  await runPolyResolve();
  logInfo("Done.");
}

async function runPolyRedeem() {
  const config = loadConfig();

  if (!config.polyPrivateKey) {
    logError("POLY_PRIVATE_KEY not set — cannot redeem on-chain");
    process.exit(1);
  }

  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  const wonPoly = resolutions.filter(r => r.venue === "polymarket" && r.won);

  if (wonPoly.length === 0) {
    logInfo("No won Polymarket positions to redeem.");
    return;
  }

  // Deduplicate by conditionId — one redemption per market is enough
  const unique = new Map<string, Resolution>();
  for (const r of wonPoly) unique.set(r.marketId, r);

  logInfo(`Redeeming ${unique.size} won Polymarket position(s)...`);
  logInfo(`(Calling redeemPositions on CTF contract — requires MATIC for gas)\n`);

  let ok = 0;
  for (const res of unique.values()) {
    const result = await redeemPolyPosition(config, res.marketId);
    if ("error" in result) {
      logError(`  Failed ${res.question.slice(0, 50)}: ${result.error}`);
    } else {
      logInfo(`  Redeemed: ${res.question.slice(0, 50)}`);
      logInfo(`    tx: https://polygonscan.com/tx/${result.txHash}`);
      ok++;
    }
  }

  logInfo(`\nRedeemed: ${ok}/${unique.size}`);
}

function runStats() {
  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);

  if (resolutions.length === 0) {
    logInfo("No resolved bets yet.");
    return;
  }

  const report = computeCalibration(resolutions);

  const roiSign = report.roi >= 0 ? "+" : "";
  console.log(`\n=== Calibration Report (${report.totalResolved} resolved) ===\n`);
  console.log(`  Win rate:    ${(report.winRate * 100).toFixed(1)}%`);
  console.log(`  Brier score: ${report.avgBrierScore.toFixed(3)}`);
  console.log(`  Total PnL:   ${report.totalPnl >= 0 ? "+" : ""}M$${report.totalPnl.toFixed(1)}`);
  console.log(`  ROI:         ${roiSign}${(report.roi * 100).toFixed(1)}%`);

  if (report.buckets.length > 0) {
    console.log(`\n  --- Calibration Buckets ---`);
    for (const b of report.buckets) {
      const oc =
        Math.abs(b.overconfidence) >= 0.05
          ? ` (${b.overconfidence > 0 ? "over" : "under"} by ${(Math.abs(b.overconfidence) * 100).toFixed(0)}pts)`
          : " (calibrated)";
      console.log(
        `  ${b.range.padEnd(8)} n=${String(b.count).padEnd(3)} est=${(b.avgEstimate * 100).toFixed(0)}% actual=${(b.actualFrequency * 100).toFixed(0)}%${oc}`
      );
    }
  }

  const conf = report.byConfidence;
  console.log(`\n  --- By Confidence ---`);
  for (const level of ["high", "medium", "low"] as const) {
    const c = conf[level];
    if (c.count === 0) continue;
    console.log(
      `  ${level.padEnd(7)} n=${String(c.count).padEnd(3)} win=${(c.winRate * 100).toFixed(0)}% brier=${c.avgBrier.toFixed(2)} roi=${(c.roi * 100).toFixed(1)}%`
    );
  }

  if (report.totalResolved >= 20) {
    const t = report.recentTrend;
    console.log(`\n  --- Recent Trend (last 20) ---`);
    console.log(
      `  Win: ${(t.winRate * 100).toFixed(0)}% | Brier: ${t.avgBrier.toFixed(2)} | ROI: ${(t.roi * 100).toFixed(1)}%`
    );
  }

  console.log("");
}

async function runSellCmd() {
  const config = loadConfig();
  logInfo(`Sell mode — ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  await runSell(config);
  logInfo("Done.");
}

async function runMonitor() {
  const config = loadConfig();
  logInfo("Hourly monitor cycle...");

  // 1. Check resolutions + record snapshots
  await runResolve(config.manifoldApiKey);

  // 2. Compute drift metrics from snapshots
  const snapshots = readJsonl<PositionSnapshot>(SNAPSHOTS_FILE);
  const trades = readJsonl<TradeExecution>(TRADES_FILE);
  const resolutions = readJsonl<Resolution>(RESOLUTIONS_FILE);
  const resolvedIds = new Set(resolutions.map((r) => r.traceId));

  // Get currently open trade IDs
  const openTrades = trades.filter(
    (t) => !t.dryRun && t.result?.betId && !t.result.error && !resolvedIds.has(t.traceId)
  );

  if (openTrades.length === 0) {
    logInfo("No open positions to monitor.");
    return;
  }

  // For each open position, compute drift from latest snapshot
  const tradeMap = new Map(openTrades.map((t) => [t.traceId, t]));

  // Group snapshots by traceId, take the most recent
  const latestSnapshots = new Map<string, PositionSnapshot>();
  for (const s of snapshots) {
    if (!tradeMap.has(s.traceId)) continue;
    const existing = latestSnapshots.get(s.traceId);
    if (!existing || s.timestamp > existing.timestamp) {
      latestSnapshots.set(s.traceId, s);
    }
  }

  let totalUnrealizedPnl = 0;
  let positveDrift = 0;
  let totalDrift = 0;

  console.log(`\n=== Portfolio Monitor (${openTrades.length} positions) ===\n`);

  for (const trade of openTrades) {
    const snap = latestSnapshots.get(trade.traceId);
    if (!snap) continue;

    // Drift: did market move toward our position?
    const dirSign = trade.direction === "YES" ? 1 : -1;
    const drift = (snap.currentProb - trade.marketProb) * dirSign;

    totalUnrealizedPnl += snap.unrealizedPnl;
    totalDrift++;
    if (drift > 0) positveDrift++;

    const driftStr = drift >= 0 ? "+" : "";
    const pnlStr = snap.unrealizedPnl >= 0 ? `+M$${snap.unrealizedPnl.toFixed(1)}` : `M$${snap.unrealizedPnl.toFixed(1)}`;
    console.log(
      `  ${trade.direction} ${trade.question.slice(0, 50)} | ${pnlStr} | drift: ${driftStr}${(drift * 100).toFixed(1)}pts`
    );
  }

  const agreementRate = totalDrift > 0 ? positveDrift / totalDrift : 0;
  const totalPnlStr = totalUnrealizedPnl >= 0 ? `+M$${totalUnrealizedPnl.toFixed(1)}` : `M$${totalUnrealizedPnl.toFixed(1)}`;

  console.log(`\n  --- Aggregate ---`);
  console.log(`  Unrealized P&L: ${totalPnlStr}`);
  console.log(`  Drift agreement: ${(agreementRate * 100).toFixed(0)}% (${positveDrift}/${totalDrift} positions moving our way)`);

  if (totalDrift >= 5 && agreementRate < 0.4) {
    console.log(`  WARNING: Markets consistently moving against estimates. Consider being less contrarian.`);
  } else if (totalDrift >= 5 && agreementRate > 0.7) {
    console.log(`  Strong signal: markets confirming estimates.`);
  }

  console.log("");
}

const command = process.argv[2] || "scan";

switch (command) {
  case "scan":
    runScan().catch((err) => {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
    break;
  case "resolve":
    runResolveCmd().catch((err) => {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
    break;
  case "sell":
    runSellCmd().catch((err) => {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
    break;
  case "monitor":
    runMonitor().catch((err) => {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
    break;
  case "stats":
    runStats();
    break;
  case "poly:scan":
    runPolyScan().catch((err) => {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
    break;
  case "redeem:poly":
    runPolyRedeem().catch((err) => {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
    break;
  default:
    logError(`Unknown command: ${command}. Use: scan, resolve, sell, monitor, stats, poly:scan, redeem:poly`);
    process.exit(1);
}
