import { loadConfig } from "./config.js";
import { getMe, searchMarkets, getMarket } from "./manifold.js";
import { estimateProbability } from "./analyzer.js";
import { filterMarkets, makeDecision } from "./strategy.js";
import { executeBets } from "./executor.js";
import { logDecision, logInfo, logError } from "./logger.js";
import { readJsonl, RESOLUTIONS_FILE } from "./data.js";
import { runResolve } from "./resolver.js";
import { computeCalibration } from "./calibration.js";
import { formatFeedback } from "./feedback.js";
import type { TradeDecision, Resolution } from "./types.js";

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

  logInfo("Searching for markets...");
  const rawMarkets = await searchMarkets(config.manifoldApiKey, 50);
  logInfo(`Fetched ${rawMarkets.length} markets`);

  const candidates = filterMarkets(rawMarkets, config);
  logInfo(`${candidates.length} markets pass filters`);

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
  logInfo("Done.");
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
  case "stats":
    runStats();
    break;
  default:
    logError(`Unknown command: ${command}. Use: scan, resolve, stats`);
    process.exit(1);
}
