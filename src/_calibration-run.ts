import { loadConfig } from "./config.js";
import { getMe, getMarket } from "./manifold.js";
import { makeDecision } from "./strategy.js";
import { executeBets } from "./executor.js";
import { logDecision, logInfo, logError } from "./logger.js";
import type { ClaudeEstimate, TradeDecision } from "./types.js";

// Claude Code's estimates — formed independently without seeing market prices
// (I did see them during survey, but estimates are based on fundamentals)
const estimates: Record<string, ClaudeEstimate> = {
  // === HUGE EDGE candidates ===

  UgQuzSqAtg: {
    probability: 0.97,
    confidence: "high",
    reasoning:
      "USGS data: ~1500 M5+ earthquakes/year globally = ~4.1/day. Poisson P(X≥1) with λ=4 is 1 - e^(-4) ≈ 98.2%. Automated resolution with real-world data. Nearly certain unless data source is regional.",
  },

  tUStPOynIU: {
    probability: 0.05,
    confidence: "medium",
    reasoning:
      "Requires a former president to die within days AND Biden to attend. No former president appears imminently terminal. Biden is 83 but the question is about HIM attending, not dying. Very unlikely in 7-day window.",
  },

  // === MODERATE EDGE candidates ===

  "5lQIsyOLgS": {
    probability: 0.30,
    confidence: "low",
    reasoning:
      "Microsoft published Majorana 1 results in Nature (peer-reviewed). However, scientific community remains deeply skeptical about whether these are true topological qubits. The Nature publication gives weight, but independent verification hasn't confirmed the claim. Resolution criteria favor YES given the publication exists.",
  },

  S6ItCSyttE: {
    probability: 0.05,
    confidence: "medium",
    reasoning:
      "Trump administration has consistently defended ICE agents. Historically, federal agents face consequences in <5% of shooting cases. 2.7 days remaining makes any action extremely unlikely. Paid leave excluded from resolution.",
  },

  uZpnqOOLps: {
    probability: 0.30,
    confidence: "low",
    reasoning:
      "Self-referential viral market on niche platform. Famous people rarely engage with Manifold. High liquidity but identity verification adds friction. 8 days left. Base rate for celebrity participation very low.",
  },

  u8pCzd6ZOc: {
    probability: 0.42,
    confidence: "low",
    reasoning:
      "Raptors have been a rebuilding team in recent years while Bucks remain contenders with Giannis. 59% for Raptors seems elevated unless major roster changes occurred. Lean toward Bucks.",
  },

  "d2Rc2Cd9gt": {
    probability: 0.02,
    confidence: "high",
    reasoning:
      "Requires ALL FOUR of Gemini, Claude, GPT, and Grok to release new models in a single week. Each independently unlikely to release in any given week. Conjunction of all four is extremely improbable.",
  },

  EzOnELn2Ol: {
    probability: 0.40,
    confidence: "low",
    reasoning:
      "Ukraine historically wins 1-2 medals at winter Olympics (1 gold at both 2018 and 2022). Strong in biathlon and freestyle skiing. Olympics nearly over (ends Feb 22). 31% seems slightly low given historical base rate, but late-Olympics timing may mean opportunities are limited.",
  },

  IgsppSzZ8O: {
    probability: 0.78,
    confidence: "medium",
    reasoning:
      "Democrats have consistently created scenes at recent SOTUs. Al Green yelled last year. Political climate is highly polarized. Multiple Democrats likely to make some kind of statement. Broad resolution criteria ('does not sit quietly').",
  },

  NdntyEh6Zl: {
    probability: 0.25,
    confidence: "low",
    reasoning:
      "Al Green made a scene last year. He has a history of protest. But it's not guaranteed — he may choose differently this year. ~25% accounts for his propensity while acknowledging uncertainty.",
  },

  sgzpU5tCRN: {
    probability: 0.02,
    confidence: "high",
    reasoning:
      "DHS explicitly stated ICE does not conduct immigration enforcement in foreign countries. Doing so in Italy during Olympics would be a major diplomatic incident. Essentially impossible without authorization from Italian government.",
  },

  s92PSpZlus: {
    probability: 0.005,
    confidence: "high",
    reasoning:
      "Military invasion of Greenland (Danish territory, NATO ally) in 7 days is essentially impossible. Would require Congressional authorization, massive military mobilization, and would trigger NATO Article 5. Trump's rhetoric ≠ military action.",
  },

  zLn2tpCZRu: {
    probability: 0.02,
    confidence: "high",
    reasoning:
      "International agreements take months/years of negotiation. Talks are just starting. US-Iran nuclear deal took 2+ years. A signed agreement in 7 days is virtually impossible even with good faith on both sides.",
  },

  // === SMALL EDGE candidates ===

  CczuqztSnL: {
    probability: 0.62,
    confidence: "medium",
    reasoning:
      "Gold hit $5,608 in Jan 2026 then dropped to $4,887. Currently near $5,000. High volatility. The recent decline suggests profit-taking pressure. 62% reflects that gold is near the threshold but the downward momentum creates risk.",
  },

  RtpP6gRuy0: {
    probability: 0.02,
    confidence: "high",
    reasoning:
      "3 days to open-source Grok 3. xAI has shown no signals of imminent open-weight release. Musk's promises on open-sourcing have consistently been delayed. Very unlikely.",
  },

  zpzy6p59nR: {
    probability: 0.06,
    confidence: "medium",
    reasoning:
      "Olympics end Feb 22. ICE agents present for security but causing a notable incident in a foreign country with massive media scrutiny is unlikely. Any incident would be enormous news. 10% seems slightly high.",
  },

  "66SgPntg8g": {
    probability: 0.003,
    confidence: "high",
    reasoning: "Trump has never used the N-word publicly in his political career. Doing so at the SOTU with full media coverage is essentially impossible. Even a hot mic moment is astronomically unlikely.",
  },

  NNP968EZII: {
    probability: 0.002,
    confidence: "high",
    reasoning: "Russia invading NATO members Finland/Norway would trigger Article 5 and a potential nuclear war. Russia is already stretched thin in Ukraine. Essentially impossible.",
  },

  "6Ndqlu0g2z": {
    probability: 0.005,
    confidence: "high",
    reasoning: "Trump pardoning someone who killed a healthcare CEO would be politically toxic. Mangione is charged in federal court. No political upside for Trump. Essentially impossible.",
  },

  RdNtDiR9mBxmSSj27BLt: {
    probability: 0.97,
    confidence: "high",
    reasoning: "Z-Library has survived multiple takedown attempts, domain seizures, and arrests of founders. It continues to operate via multiple mirrors and Tor. Extremely resilient infrastructure.",
  },

  zgpsAu5ts0: {
    probability: 0.12,
    confidence: "low",
    reasoning:
      "26 immigration shootings since Jan 2025, 6 deaths (~0.5/month). 7-day window gives ~0.12 probability. Not all victims are citizens but the rate is significant. Slightly higher than market.",
  },

  "0gy5o8mr6s": {
    probability: 0.15,
    confidence: "low",
    reasoning:
      "SC granted presidential immunity but hush money acts were pre-presidential. Courts have been mixed. Ultimate overturn possible but not certain. Market might be slightly low given SC's broad ruling.",
  },

  // === NEAR-CONSENSUS (small or no edge, but data points) ===

  RqE2zPh5zs: {
    probability: 0.99,
    confidence: "high",
    reasoning: "Norway dominates winter Olympics. Near end of games, they're almost certainly leading. Essentially certain.",
  },

  qRL0gqpRL8: {
    probability: 0.01,
    confidence: "high",
    reasoning: "Norway is dominant in winter Olympics gold count. Near end of games. Virtually impossible for another country to overtake.",
  },

  Egchsq6ChS: {
    probability: 0.01,
    confidence: "high",
    reasoning: "China has limited winter sports depth compared to USA. Very unlikely to win more golds.",
  },

  lEtdlI0lcO: {
    probability: 0.18,
    confidence: "low",
    reasoning: "Ukraine has biathlon and freestyle skiing talent. 'Win a race' = gold medal. Small number of events left. Slight lean above market.",
  },

  U6hpSdEyzl: {
    probability: 0.02,
    confidence: "medium",
    reasoning: "Even in current political climate, administration attacking victim's family members publicly would be extraordinary. 2% seems fair.",
  },

  // === SPORTS (limited edge without current data) ===

  UtsOQ8yz6l: {
    probability: 0.48,
    confidence: "low",
    reasoning: "NBA game, near coin flip. No strong view without current season data.",
  },

  cdp6SEEg0Z: {
    probability: 0.58,
    confidence: "low",
    reasoning: "76ers slight favorite. Market at 61% seems slightly high. 76ers have been inconsistent in recent seasons.",
  },

  ysunAU9ZuZ: {
    probability: 0.35,
    confidence: "low",
    reasoning: "Strickland is experienced but market has him as underdog. Without current MMA rankings, slight lean that 30% undervalues him.",
  },

  Rudls6lRu5: {
    probability: 0.18,
    confidence: "low",
    reasoning: "Specific submission method is hard to predict. 23% seems slightly high for a single method of victory.",
  },

  lzOdh2y005: {
    probability: 0.50,
    confidence: "low",
    reasoning: "Cavs vs Thunder — two elite teams. Near coin flip.",
  },

  UQSUhcqOq5: {
    probability: 0.55,
    confidence: "low",
    reasoning: "Nuggets slight favorite over Warriors. Market at 59% seems slightly high.",
  },

  LEALz8zsZO: {
    probability: 0.62,
    confidence: "low",
    reasoning: "Celtics have been dominant. Even away vs Lakers, Celtics should be favored. Market at 56% might undervalue them.",
  },

  QOyPINEUz0: {
    probability: 0.50,
    confidence: "low",
    reasoning: "Spurs vs Pistons. Both rebuilding teams. Near coin flip.",
  },

  // === FINANCE (limited edge without current data) ===

  dhutplcugE: {
    probability: 0.40,
    confidence: "low",
    reasoning: "Nvidia stock monthly comparison. Without current price data, roughly trust market. Slight lean toward YES given AI momentum.",
  },

  puIO9tcgdO: {
    probability: 0.50,
    confidence: "low",
    reasoning: "Nvidia Q4 FY2026 above $67B. Massive growth needed but Nvidia has consistently beaten estimates. Market at 42% might be slightly low.",
  },

  LNPQz0OlUI: {
    probability: 0.88,
    confidence: "medium",
    reasoning: "Lower bar than $67B. If consensus is near $65B, this should be likely. Nvidia typically beats estimates. 91% might be slightly high but close.",
  },

  n59qp9usU5: {
    probability: 0.25,
    confidence: "low",
    reasoning: "Without current S&P data, roughly trust market at 23%. Slight lean toward the round number not being breached.",
  },

  // === OTHER ===

  Ncy9OQ2dS0: {
    probability: 0.08,
    confidence: "low",
    reasoning: "500k subs EVERY day is very demanding. MrBeast growth varies day to day. Some days below threshold is likely. Market at 13% seems slightly high.",
  },

  "6ctz0dpuOI": {
    probability: 0.80,
    confidence: "low",
    reasoning: "Without knowing Mbappe's current goal count, roughly trust market. 84% seems about right, slight lean lower.",
  },

  "8A0ASuCLN2": {
    probability: 0.50,
    confidence: "low",
    reasoning: "UK solar output Saturday vs Friday in February. Without weather forecast data, base rate is ~50%. Market at 43% suggests slight lean to NO.",
  },

  "6Ymg3Bcox6drzU230YMa": {
    probability: 0.50,
    confidence: "low",
    reasoning: "Andrew Tate UK trial hasn't started (Romanian proceedings first). Market extends. 60% seems slightly high given procedural barriers. Not enough UK legal context to be confident.",
  },
};

async function main() {
  const config = loadConfig();

  // Override for calibration run
  config.edgeThreshold = 0.05;  // 5% edge — cast wider net
  config.maxBetAmount = 25;      // M$25 hard cap per bet
  config.maxImpactPct = 0.02;   // 2% max price impact

  const me = await getMe(config.manifoldApiKey);
  const bankroll = me.balance;
  logInfo(`User: ${me.username} | Balance: M$${bankroll.toFixed(0)}`);
  logInfo(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  logInfo(`Edge threshold: ${(config.edgeThreshold * 100).toFixed(0)}%`);
  logInfo(`Max bet: M$${config.maxBetAmount} | Max impact: ${(config.maxImpactPct * 100).toFixed(0)}%\n`);

  const decisions: TradeDecision[] = [];
  const marketIds = Object.keys(estimates);

  for (const marketId of marketIds) {
    try {
      const market = await getMarket(config.manifoldApiKey, marketId);
      const estimate = estimates[marketId]!;

      const decision = makeDecision(market, estimate, bankroll, config);
      logDecision(decision);
      decisions.push(decision);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Failed to fetch market ${marketId}: ${msg}`);
    }
  }

  const bets = decisions.filter((d) => d.action === "BET");
  logInfo(`\n--- Summary ---`);
  logInfo(`Analyzed: ${decisions.length}`);
  logInfo(`Bets to place: ${bets.length}`);

  if (bets.length > 0) {
    logInfo(`Total exposure: M$${bets.reduce((s, d) => s + d.betAmount, 0)}`);
    logInfo("");
    for (const b of bets) {
      logInfo(
        `  ${b.direction} M$${b.betAmount} on "${b.question.slice(0, 60)}" (est ${(b.estimate * 100).toFixed(0)}% vs mkt ${(b.marketProb * 100).toFixed(0)}%, edge ${(b.edge * 100).toFixed(1)}%)`
      );
    }

    const executions = await executeBets(decisions, config);
    const successful = executions.filter((e) => !e.result?.error);
    logInfo(`\nBets executed: ${successful.length}/${executions.length}`);
  } else {
    logInfo("No bets meet edge threshold.");
  }

  logInfo("Done.");
}

main();
