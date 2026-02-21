import { loadConfig } from "./config.js";

const BASE = "https://api.manifold.markets/v0";

async function main() {
  const config = loadConfig();
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  const url = new URL(`${BASE}/search-markets`);
  url.searchParams.set("filter", "open");
  url.searchParams.set("contractType", "BINARY");
  url.searchParams.set("sort", "close-date");
  url.searchParams.set("limit", "500");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Key ${config.manifoldApiKey}` },
  });
  const markets = await res.json() as any[];

  // Markets closing within 6 hours
  const closingSoon = markets.filter((m: any) => {
    const ttc = m.closeTime - now;
    return !m.isResolved && ttc > 0 && ttc < 6 * ONE_HOUR && m.outcomeType === "BINARY";
  });

  closingSoon.sort((a: any, b: any) => a.closeTime - b.closeTime);

  console.log(`Markets closing within 6 hours: ${closingSoon.length}\n`);

  for (const m of closingSoon) {
    const mins = Math.round((m.closeTime - now) / 60000);
    const hrs = (mins / 60).toFixed(1);
    console.log(
      `[${(m.probability * 100).toFixed(0)}%] ${m.question.slice(0, 90)}`
    );
    console.log(
      `     closes in ${mins < 120 ? mins + "min" : hrs + "h"} | M$${(m.totalLiquidity ?? 0).toFixed(0)} liq | ${m.uniqueBettorCount ?? 0} bettors | id:${m.id}`
    );
    console.log();
  }
}

main();
