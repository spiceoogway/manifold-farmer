import { loadConfig } from "./config.js";

const BASE = "https://api.manifold.markets/v0";

async function search(apiKey: string, params: Record<string, string>) {
  const url = new URL(`${BASE}/search-markets`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Key ${apiKey}` },
  });
  return res.json() as Promise<any[]>;
}

async function main() {
  const config = loadConfig();
  const apiKey = config.manifoldApiKey;
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  const markets = await search(apiKey, {
    filter: "open",
    contractType: "BINARY",
    sort: "close-date",
    limit: "500",
  });

  const shortTerm = markets.filter((m: any) => {
    const ttc = m.closeTime - now;
    return !m.isResolved && ttc > ONE_HOUR && ttc < 7 * ONE_DAY && (m.uniqueBettorCount ?? 0) >= 1;
  });

  shortTerm.sort((a: any, b: any) => a.closeTime - b.closeTime);

  console.log(`Fetched: ${markets.length} | Short-term (<7d): ${shortTerm.length}\n`);

  // Skip pure-random markets
  const nonRandom = shortTerm.filter((m: any) => {
    const q = m.question.toLowerCase();
    return !q.includes("coinflip") && !q.includes("coin flip") && !q.includes("lottery") && !q.includes("random");
  });

  console.log(`Non-random: ${nonRandom.length}\n`);

  for (const m of nonRandom) {
    const days = ((m.closeTime - now) / ONE_DAY).toFixed(1);
    const liq = m.totalLiquidity?.toFixed(0) ?? "?";
    console.log(
      `[${(m.probability * 100).toFixed(0)}%] ${m.question.slice(0, 90)}`
    );
    console.log(
      `     closes ${days}d | M$${liq} liq | ${m.uniqueBettorCount ?? 0} bettors | id:${m.id}`
    );
    console.log();
  }
}

main();
