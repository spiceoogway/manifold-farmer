import { loadConfig } from "./config.js";
import { getMe, getMarket } from "./manifold.js";
import { makeDecision } from "./strategy.js";
import { executeBets } from "./executor.js";
import { logDecision, logInfo, logError } from "./logger.js";
import type { ClaudeEstimate, TradeDecision } from "./types.js";

// Claude Code's estimates — updated 2026-02-21 after 12h price movements
const estimates: Record<string, ClaudeEstimate> = {
  // === HIGH EDGE ===

  // ICE Olympics incident: market spiked 10%→53%. Unless a real incident occurred,
  // this seems like overreaction. Olympics end tomorrow. ICE agents are there for
  // security, not enforcement. DHS explicitly said no enforcement abroad.
  zpzy6p59nR: {
    probability: 0.15,
    confidence: "medium",
    reasoning:
      "Market spiked from 10% to 53% — possibly reacting to news. But ICE agents at Olympics are security support, not enforcement. DHS explicitly stated no immigration enforcement abroad. Even if some minor friction occurred, a 'significant event with substantial media coverage' per resolution criteria is a high bar. Olympics end Feb 22.",
  },

  // Nvidia >$65B crashed from 91%→51% while >$67B rose to 74%.
  // This is inconsistent: if P(>$67B)=74%, then P(>$65B) must be ≥74%.
  // Clear mispricing.
  LNPQz0OlUI: {
    probability: 0.80,
    confidence: "medium",
    reasoning:
      "Nvidia >$65B at 51% is inconsistent with the >$67B market at 74%. If there's ≥74% chance revenue exceeds $67B, there's at least 74% chance it exceeds $65B. This is a logical arbitrage. Nvidia has consistently beaten estimates. 80% is conservative given the other market's pricing.",
  },

  // Raptors/Bucks: market moved from 59%→66% for Raptors. I still lean Bucks.
  u8pCzd6ZOc: {
    probability: 0.42,
    confidence: "low",
    reasoning:
      "Raptors have been rebuilding while Bucks remain contenders with Giannis. 66% for Raptors is even more elevated than before. Edge widened. Lean toward Bucks unless Giannis is injured/resting.",
  },

  // Celtics/Lakers: market dropped from 56%→52%. Celtics still favored in my view.
  LEALz8zsZO: {
    probability: 0.62,
    confidence: "low",
    reasoning:
      "Celtics have been dominant in the Tatum era. Even on the road vs Lakers, their overall talent and depth should make them slight favorites. Market at 52% undervalues them.",
  },

  // Biden attends funeral: still at 21%. No former president is dying imminently.
  tUStPOynIU: {
    probability: 0.05,
    confidence: "medium",
    reasoning:
      "Requires a former president to die within ~6 days AND Biden to attend. No former president appears imminently terminal. Extremely unlikely.",
  },

  // Famous person bet: still ~47%.
  uZpnqOOLps: {
    probability: 0.30,
    confidence: "low",
    reasoning:
      "Self-referential viral market on niche platform. Famous people rarely engage with Manifold. High liquidity but identity verification adds friction. 7 days left.",
  },

  // Microsoft Majorana: still 19%.
  "5lQIsyOLgS": {
    probability: 0.30,
    confidence: "low",
    reasoning:
      "Microsoft published in Nature (peer-reviewed). Scientific community skeptical but resolution criteria say 'peer-reviewed research or verifiable technical documentation.' Nature publication exists. Lean YES.",
  },

  // ICE consequences: dropped from 13%→8%. Closer to my estimate.
  S6ItCSyttE: {
    probability: 0.04,
    confidence: "medium",
    reasoning:
      "Trump admin consistently defends ICE. Federal agents face consequences in <5% of shootings historically. Only 2 days left on market. Paid leave excluded. Very unlikely.",
  },

  // Al Green scene at SOTU: still 14%.
  NdntyEh6Zl: {
    probability: 0.25,
    confidence: "low",
    reasoning:
      "Al Green made a scene last year. He has a pattern. But not guaranteed — ~25% reflects his propensity while acknowledging he might not.",
  },

  // Democrat SOTU distraction: 70%.
  IgsppSzZ8O: {
    probability: 0.78,
    confidence: "medium",
    reasoning:
      "Democrats have consistently created scenes at recent SOTUs. Broad criteria ('does not sit quietly'). Very likely at least one Democrat makes a statement.",
  },

  // Gold above $5000: still 73%.
  CczuqztSnL: {
    probability: 0.62,
    confidence: "medium",
    reasoning:
      "Gold hit $5,608 in late Jan then fell to $4,887. High volatility. 62% reflects proximity to threshold but downward momentum creates risk. 73% seems overconfident.",
  },

  // Andrew Tate guilty: still 60%.
  "6Ymg3Bcox6drzU230YMa": {
    probability: 0.50,
    confidence: "low",
    reasoning:
      "UK trial hasn't started — Romanian proceedings must finish first. Market extends. 60% seems slightly high given procedural barriers.",
  },

  // === MODERATE EDGE ===

  // Nvidia >$67B: jumped from 42%→74%. Market knows something I don't.
  // Adjust my estimate up but still below market.
  puIO9tcgdO: {
    probability: 0.65,
    confidence: "low",
    reasoning:
      "Market jumped from 42%→74%, suggesting leaked info or updated analyst consensus. Nvidia has consistently beaten estimates. But the jump was dramatic — some caution warranted. 65% reflects updated info while maintaining some skepticism.",
  },

  // Nuggets/Warriors: market at 66%, I think slightly less.
  UQSUhcqOq5: {
    probability: 0.55,
    confidence: "low",
    reasoning:
      "Nuggets favored but 66% seems elevated. Without injury info, lean slightly toward regression. Jokic is dominant but Warriors can compete.",
  },

  // 76ers/Pelicans: market at 66%.
  cdp6SEEg0Z: {
    probability: 0.58,
    confidence: "low",
    reasoning:
      "76ers are favored but have been inconsistent. 66% is slightly high.",
  },

  // Strickland/Hernandez: still 30%.
  ysunAU9ZuZ: {
    probability: 0.38,
    confidence: "low",
    reasoning:
      "Strickland is experienced and crafty. 30% might undervalue him slightly. Former champion.",
  },

  // Hernandez by submission: 23%.
  Rudls6lRu5: {
    probability: 0.18,
    confidence: "low",
    reasoning:
      "Specific submission method is hard to predict. 23% seems slightly high for one method.",
  },

  // Mbappe 25 goals: dropped to 52%.
  "6ctz0dpuOI": {
    probability: 0.45,
    confidence: "low",
    reasoning:
      "Dropped from 84%→52%. Suggests he hasn't reached 25 yet and few games remain. Market uncertainty is appropriate. Slight lean NO.",
  },

  // Nvidia stock Feb>Jan: 38%.
  dhutplcugE: {
    probability: 0.40,
    confidence: "low",
    reasoning:
      "Without current price data, roughly trust market. Slight lean YES given AI momentum.",
  },

  // Trump attend Olympics hockey final: crashed to 14%.
  uUs9IO896I: {
    probability: 0.08,
    confidence: "medium",
    reasoning:
      "Dropped from 68%→14%. Likely US didn't make the final or logistics make it very unlikely. Trump attending a foreign event is logistically complex. 14% still seems high.",
  },

  // Doping disqualification at Olympics: 48%.
  "5d5On9NdA6": {
    probability: 0.35,
    confidence: "low",
    reasoning:
      "Major doping disqualification at any Olympics is uncommon during the games themselves. Most are caught later in re-testing. Olympics nearly over. 48% seems high.",
  },

  // === LOW/NO EDGE (keeping for data volume) ===

  S6ItCSyttE_skip: undefined as never, // already included above

  lzOdh2y005: {
    probability: 0.50,
    confidence: "low",
    reasoning: "Cavs vs Thunder — two elite teams. Near coin flip.",
  },

  QOyPINEUz0: {
    probability: 0.50,
    confidence: "low",
    reasoning: "Spurs vs Pistons. Rebuilding teams. Near coin flip.",
  },

  "0gy5o8mr6s": {
    probability: 0.15,
    confidence: "low",
    reasoning:
      "SC granted presidential immunity but hush money acts were pre-presidential. Ultimate overturn possible. Market at 11% might be slightly low.",
  },

  zgpsAu5ts0: {
    probability: 0.12,
    confidence: "low",
    reasoning:
      "26 immigration shootings since Jan 2025, 6 deaths (~0.5/month). 7-day window gives ~0.12 probability.",
  },

  zLn2tpCZRu: {
    probability: 0.02,
    confidence: "high",
    reasoning:
      "A signed US-Iran agreement in ~6 days is virtually impossible given diplomatic timelines.",
  },

  sgzpU5tCRN: {
    probability: 0.02,
    confidence: "high",
    reasoning:
      "DHS explicitly said no immigration enforcement abroad. Essentially impossible.",
  },

  s92PSpZlus: {
    probability: 0.005,
    confidence: "high",
    reasoning:
      "Military invasion of a NATO ally territory is essentially impossible.",
  },

  n59qp9usU5: {
    probability: 0.25,
    confidence: "low",
    reasoning: "Without current S&P data, roughly trust market.",
  },
};

// Remove the undefined placeholder
delete (estimates as any).S6ItCSyttE_skip;

async function main() {
  const config = loadConfig();

  // Override for calibration run
  config.edgeThreshold = 0.05;  // 5% edge — cast wider net
  config.maxBetAmount = 25;      // M$25 hard cap per bet

  const me = await getMe(config.manifoldApiKey);
  const bankroll = me.balance;
  logInfo(`User: ${me.username} | Balance: M$${bankroll.toFixed(0)}`);
  logInfo(`Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  logInfo(`Edge threshold: ${(config.edgeThreshold * 100).toFixed(0)}%`);
  logInfo(`Max bet: M$${config.maxBetAmount} | Slippage-aware Kelly sizing\n`);

  const decisions: TradeDecision[] = [];
  const marketIds = Object.keys(estimates);

  for (const marketId of marketIds) {
    try {
      const market = await getMarket(config.manifoldApiKey, marketId);

      // Skip if market already closed or resolved
      if (market.isResolved || market.closeTime < Date.now()) {
        logInfo(`  --- Skipping ${market.question.slice(0, 50)} (closed/resolved)`);
        continue;
      }

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
