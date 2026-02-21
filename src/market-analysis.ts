/**
 * Market calibration analysis by category.
 *
 * Fetches resolved BINARY markets from Manifold, classifies them by
 * question text into categories, and computes per-category calibration
 * metrics. Outputs ranked categories by miscalibration x volume.
 *
 * Usage: npx tsx src/market-analysis.ts
 */

import { loadConfig } from "./config.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "https://api.manifold.markets/v0";

// ---------------------------------------------------------------------------
// Category classification via keyword matching on question text
// ---------------------------------------------------------------------------

interface CategoryRule {
  name: string;
  keywords: RegExp;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    name: "US Politics",
    keywords:
      /\b(trump|biden|democrat|republican|congress|senate|gop|potus|scotus|roe v wade|electoral|midterm|presidential|governor|desantis|RFK|kamala|harris|pelosi|mcconnell)\b/i,
  },
  {
    name: "World Politics",
    keywords:
      /\b(ukraine|russia|china|xi jinping|putin|nato|eu\b|european union|brexit|israel|gaza|palestine|iran|north korea|modi|macron|zelensky|war\b|invasion|ceasefire|sanctions)\b/i,
  },
  {
    name: "AI & Technology",
    keywords:
      /\b(ai\b|artificial intelligence|gpt|openai|google deepmind|anthropic|llm|chatgpt|agi\b|machine learning|neural|transformer|compute|semiconductor|chip|nvidia|tsmc|apple|microsoft|meta\b|amazon|tesla|spacex|starship|rocket|launch)\b/i,
  },
  {
    name: "Crypto & Web3",
    keywords:
      /\b(bitcoin|btc|ethereum|eth\b|crypto|blockchain|nft|defi|solana|sol\b|binance|coinbase|stablecoin|token|dao\b|web3)\b/i,
  },
  {
    name: "Finance & Economics",
    keywords:
      /\b(stock|s&p|nasdaq|dow jones|fed\b|federal reserve|interest rate|inflation|gdp|recession|unemployment|ipo|market cap|earnings|revenue|valuation|bond|yield|tariff)\b/i,
  },
  {
    name: "Sports",
    keywords:
      /\b(nba|nfl|mlb|nhl|premier league|champions league|world cup|super bowl|playoff|championship|mvp|touchdown|goal\b|match\b|game \d|series|world series|olympics|ncaa|ufc|boxing|f1\b|formula 1|grand prix)\b/i,
  },
  {
    name: "Entertainment",
    keywords:
      /\b(oscar|grammy|emmy|box office|movie|film\b|tv show|netflix|disney|streaming|album|song|concert|celebrity|actor|actress|award)\b/i,
  },
  {
    name: "Science & Health",
    keywords:
      /\b(covid|vaccine|pandemic|fda|drug\b|clinical trial|disease|cancer|mortality|life expectancy|climate|temperature|co2|emission|nasa|space\b|mars\b|moon\b|asteroid|earthquake|hurricane)\b/i,
  },
  {
    name: "Manifold & Personal",
    keywords:
      /\b(manifold|mana|this market|my\b|I will|I'll|personal|new year|resolution|daily|streak|subscriber|follower)\b/i,
  },
];

function classifyQuestion(question: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(question)) {
      return rule.name;
    }
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Manifold API helpers
// ---------------------------------------------------------------------------

let requestTimes: number[] = [];

async function rateLimit(): Promise<void> {
  const now = Date.now();
  requestTimes = requestTimes.filter((t) => now - t < 60_000);
  if (requestTimes.length >= 450) {
    const oldest = requestTimes[0]!;
    const waitMs = 60_000 - (now - oldest) + 100;
    console.log(`  [rate limit] waiting ${(waitMs / 1000).toFixed(1)}s...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  requestTimes.push(Date.now());
}

interface LiteMarket {
  id: string;
  question: string;
  probability: number;
  totalLiquidity: number;
  volume: number;
  isResolved: boolean;
  resolution?: string;
  resolutionProbability?: number;
  uniqueBettorCount?: number;
  closeTime?: number;
}

async function fetchResolvedMarkets(
  apiKey: string,
  maxPages: number = 30
): Promise<LiteMarket[]> {
  const all: LiteMarket[] = [];

  for (let page = 0; page < maxPages; page++) {
    await rateLimit();
    const url = new URL(`${BASE}/search-markets`);
    url.searchParams.set("filter", "resolved");
    url.searchParams.set("contractType", "BINARY");
    url.searchParams.set("sort", "resolve-date");
    url.searchParams.set("limit", "500");
    url.searchParams.set("offset", String(page * 500));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Key ${apiKey}` },
    });

    if (!res.ok) {
      console.error(`API error: ${res.status} ${await res.text()}`);
      break;
    }

    const markets = (await res.json()) as LiteMarket[];
    if (!Array.isArray(markets) || markets.length === 0) break;

    // Filter to YES/NO resolutions only (skip MKT, CANCEL)
    const valid = markets.filter(
      (m) => m.resolution === "YES" || m.resolution === "NO"
    );
    all.push(...valid);

    process.stdout.write(
      `\r  Fetched ${all.length} resolved markets (page ${page + 1})...`
    );

    if (markets.length < 500) break;
  }

  console.log();
  return all;
}

// ---------------------------------------------------------------------------
// Calibration computation
// ---------------------------------------------------------------------------

interface CalibrationBucket {
  range: string;
  rangeMin: number;
  rangeMax: number;
  count: number;
  avgPredicted: number;
  actualFrequency: number;
  overconfidence: number;
  avgLiquidity: number;
  avgVolume: number;
}

interface CategoryStats {
  name: string;
  count: number;
  buckets: CalibrationBucket[];
  overallBrier: number;
  avgLiquidity: number;
  avgVolume: number;
  exploitScore: number;
}

function computeBuckets(
  markets: LiteMarket[],
  numBuckets: number = 19
): CalibrationBucket[] {
  const step = 1 / numBuckets;
  const buckets: CalibrationBucket[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const lo = i * step;
    const hi = (i + 1) * step;
    const inBucket = markets.filter(
      (m) =>
        m.probability >= lo &&
        (i === numBuckets - 1 ? m.probability <= hi : m.probability < hi)
    );

    if (inBucket.length < 3) continue;

    const avgPred =
      inBucket.reduce((s, m) => s + m.probability, 0) / inBucket.length;
    const actualYes =
      inBucket.filter((m) => m.resolution === "YES").length / inBucket.length;
    const avgLiq =
      inBucket.reduce((s, m) => s + (m.totalLiquidity || 0), 0) /
      inBucket.length;
    const avgVol =
      inBucket.reduce((s, m) => s + (m.volume || 0), 0) / inBucket.length;

    buckets.push({
      range: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      rangeMin: lo,
      rangeMax: hi,
      count: inBucket.length,
      avgPredicted: avgPred,
      actualFrequency: actualYes,
      overconfidence: avgPred - actualYes,
      avgLiquidity: avgLiq,
      avgVolume: avgVol,
    });
  }

  return buckets;
}

function computeBrier(markets: LiteMarket[]): number {
  if (markets.length === 0) return 0;
  let sum = 0;
  for (const m of markets) {
    const actual = m.resolution === "YES" ? 1 : 0;
    sum += (m.probability - actual) ** 2;
  }
  return sum / markets.length;
}

function computeExploitScore(buckets: CalibrationBucket[]): number {
  let score = 0;
  for (const b of buckets) {
    score +=
      Math.abs(b.overconfidence) *
      Math.sqrt(b.count) *
      Math.log10(b.avgLiquidity + 1);
  }
  return score;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = loadConfig();
  console.log("Fetching resolved BINARY markets from Manifold...\n");

  const markets = await fetchResolvedMarkets(config.manifoldApiKey, 30);
  console.log(`Total resolved YES/NO markets: ${markets.length}\n`);

  // Classify each market
  const byCategory = new Map<string, LiteMarket[]>();
  for (const m of markets) {
    const cat = classifyQuestion(m.question);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(m);
  }

  // Overall calibration
  const overallBuckets = computeBuckets(markets);
  const overallBrier = computeBrier(markets);

  console.log("=== OVERALL CALIBRATION ===");
  console.log(
    `Markets: ${markets.length} | Brier: ${overallBrier.toFixed(4)}\n`
  );
  console.log(
    "Predicted  | Actual   | Gap      | Count | Avg Liq  | Avg Vol"
  );
  console.log("-".repeat(70));
  for (const b of overallBuckets) {
    const gap = b.overconfidence;
    const arrow = gap > 0.05 ? " ^OC" : gap < -0.05 ? " vUC" : "";
    console.log(
      `${b.range.padEnd(10)} | ` +
        `${(b.actualFrequency * 100).toFixed(1).padStart(5)}%  | ` +
        `${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1).padStart(5)}%${arrow.padEnd(4)} | ` +
        `${String(b.count).padStart(5)} | ` +
        `${("M$" + Math.round(b.avgLiquidity)).padStart(8)} | ` +
        `M$${Math.round(b.avgVolume)}`
    );
  }

  // Per-category calibration
  console.log("\n\n=== CALIBRATION BY CATEGORY ===\n");

  const categoryStats: CategoryStats[] = [];

  for (const [name, catMarkets] of byCategory) {
    if (catMarkets.length < 20) continue;

    const buckets = computeBuckets(catMarkets, 10);
    const brier = computeBrier(catMarkets);
    const avgLiq =
      catMarkets.reduce((s, m) => s + (m.totalLiquidity || 0), 0) /
      catMarkets.length;
    const avgVol =
      catMarkets.reduce((s, m) => s + (m.volume || 0), 0) / catMarkets.length;
    const exploitScore = computeExploitScore(buckets);

    categoryStats.push({
      name,
      count: catMarkets.length,
      buckets,
      overallBrier: brier,
      avgLiquidity: avgLiq,
      avgVolume: avgVol,
      exploitScore,
    });
  }

  // Sort by exploit score descending
  categoryStats.sort((a, b) => b.exploitScore - a.exploitScore);

  for (const cat of categoryStats) {
    console.log(
      `--- ${cat.name} (${cat.count} markets, Brier: ${cat.overallBrier.toFixed(4)}, ` +
        `Avg Liq: M$${Math.round(cat.avgLiquidity)}, Exploit Score: ${cat.exploitScore.toFixed(1)}) ---`
    );

    const sorted = [...cat.buckets].sort(
      (a, b) => Math.abs(b.overconfidence) - Math.abs(a.overconfidence)
    );
    for (const b of sorted.slice(0, 5)) {
      const gap = b.overconfidence;
      const label =
        gap > 0.03 ? "OVERCONFIDENT" : gap < -0.03 ? "UNDERCONFIDENT" : "ok";
      console.log(
        `  ${b.range.padEnd(8)} pred=${(b.avgPredicted * 100).toFixed(1)}% ` +
          `actual=${(b.actualFrequency * 100).toFixed(1)}% ` +
          `gap=${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)}% ` +
          `n=${b.count} [${label}]`
      );
    }
    console.log();
  }

  // Summary ranking
  console.log("\n=== EXPLOIT RANKING (where to build tools) ===\n");
  console.log(
    "Rank | Category           | Markets | Brier  | Avg Liq   | Exploit Score"
  );
  console.log("-".repeat(75));
  for (let i = 0; i < categoryStats.length; i++) {
    const c = categoryStats[i]!;
    console.log(
      `${String(i + 1).padStart(4)} | ${c.name.padEnd(18)} | ${String(c.count).padStart(7)} | ` +
        `${c.overallBrier.toFixed(4)} | ${("M$" + Math.round(c.avgLiquidity)).padStart(9)} | ` +
        `${c.exploitScore.toFixed(1)}`
    );
  }

  // Save results
  const output = {
    fetchedAt: new Date().toISOString(),
    totalMarkets: markets.length,
    overallBrier,
    overall: overallBuckets,
    categories: categoryStats,
  };

  const dataDir = join(__dirname, "..", "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "calibration-analysis.json"),
    JSON.stringify(output, null, 2)
  );
  console.log("\nSaved to data/calibration-analysis.json");
}

main().catch(console.error);
