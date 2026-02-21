import { loadConfig } from "./config.js";
import { searchMarkets } from "./manifold.js";

async function main() {
  const config = loadConfig();

  // Fetch a large batch
  const raw = await searchMarkets(config.manifoldApiKey, 200);

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * ONE_HOUR;

  // Filter: binary, not resolved, closes within 7 days, at least 1 bettor
  const shortTerm = raw.filter((m) => {
    if (m.outcomeType !== "BINARY") return false;
    if (m.isResolved) return false;
    const ttc = m.closeTime - now;
    if (ttc < ONE_HOUR) return false;
    if (ttc > SEVEN_DAYS) return false;
    if ((m.uniqueBettorCount ?? 0) < 1) return false;
    return true;
  });

  // Sort by close time (soonest first)
  shortTerm.sort((a, b) => a.closeTime - b.closeTime);

  console.log(`Total fetched: ${raw.length}`);
  console.log(`Short-term (1h - 7d, binary, open): ${shortTerm.length}\n`);

  // Bucket by time to close
  const buckets = [
    { label: "< 24h", max: 24 * ONE_HOUR },
    { label: "1-3 days", max: 3 * 24 * ONE_HOUR },
    { label: "3-7 days", max: SEVEN_DAYS },
  ];

  for (const b of buckets) {
    const prev = b === buckets[0] ? ONE_HOUR : buckets[buckets.indexOf(b) - 1]!.max;
    const inBucket = shortTerm.filter((m) => {
      const ttc = m.closeTime - now;
      return ttc >= prev && ttc < b.max;
    });
    console.log(`\n=== ${b.label} (${inBucket.length} markets) ===`);
    for (const m of inBucket.slice(0, 15)) {
      const days = ((m.closeTime - now) / (24 * ONE_HOUR)).toFixed(1);
      console.log(
        `  [${(m.probability * 100).toFixed(0)}%] ${m.question.slice(0, 80)} (${days}d, M$${m.totalLiquidity.toFixed(0)} liq, ${m.uniqueBettorCount} bettors)`
      );
    }
    if (inBucket.length > 15) console.log(`  ... and ${inBucket.length - 15} more`);
  }

  // Also check: how many with >50 liquidity vs <50
  const withLiq = shortTerm.filter((m) => m.totalLiquidity >= 50);
  const lowLiq = shortTerm.filter((m) => m.totalLiquidity < 50);
  console.log(`\nWith ≥50 liquidity: ${withLiq.length} | <50 liquidity: ${lowLiq.length}`);
}

main();
