# Roadmap

## Vision

Build a dominant prediction market trading system that continuously improves through fast feedback loops. Trade on **Polymarket** (real money, deep liquidity, 1,300+ fast-resolution markets per 48h) using Manifold as a low-stakes playground for experimentation.

## Why Polymarket First

Market supply analysis (Feb 2026):

| Platform | Markets resolving in 48h | Tradeable (>$10k liq) | 24h volume |
|----------|--------------------------|----------------------|------------|
| **Polymarket** | **~1,374** | **~600** | **$20.4M** |
| Kalshi | ~23,200 (mostly auto-generated parlays) | ~100 | ~$2M |
| Manifold | ~30 | ~5 | ~M$300k (play money) |

Polymarket has **45x the fast-resolution supply** of Manifold. NBA alone produces 447 markets per 48h with $16.7M daily volume. The training loop needs volume — Manifold can't supply it.

---

## Core Principles

### 1. Fast Feedback Loops
Every resolution is a calibration data point. A market that resolves in 2 hours is 360x more valuable than one resolving in 30 days.

### 2. Closed-Loop Correction
Performance data flows back into decisions automatically:
```
bet → snapshot → analyze drift → update strategy params → better bet
       ↑                                                       |
       └───────────────────────────────────────────────────────┘
```

### 3. Measure Everything, Trust Nothing
Track ROI by category, confidence level, data source. If a signal doesn't correlate with outcomes after 50+ bets, remove it.

### 4. Fail Fast, Learn Cheap
Small bets on uncertain categories to gather data. Scale up only on categories with proven positive ROI.

---

## Implementation Phases

### Phase 0: Production Hardening — ⚠️ Partial

- ✅ Request timeouts on all fetch calls
- ✅ CI/CD — GitHub Actions typecheck on PRs
- ✗ Retry with exponential backoff on transient API errors
- ✗ Shared P&L calculation module (currently duplicated across resolver/seller/snapshots)
- ✗ Tests for core math (Kelly, calibration, effective fill price)

### Phase 1: Polymarket Direct Trading — ✅ Done

Supersedes the original oracle/market-matcher approach. We trade directly on Polymarket rather than using it as a price oracle for Manifold arb.

- ✅ Market fetching via Gamma API (`fetchPolymarketMarkets`)
- ✅ Orderbook depth fetching + effective fill price calculation (slippage-aware)
- ✅ Markets with insufficient depth filtered before Claude analysis
- ✅ CLOB client with API key derivation (`createClobClient`)
- ✅ FOK order placement (`placePolyOrder`)
- ✅ Venue-aware Kelly sizing (plain Kelly for CLOB, slippage-iterated for Manifold AMM)
- ✅ `pnpm poly:scan` — full pipeline: fetch → enrich prices → Claude → Kelly → execute
- ✅ `pnpm setup:poly` — one-time USDC approval for CTF Exchange + NegRisk Exchange

### Phase 2: Polymarket Resolution & Redemption — 🔴 Next

**This is the most critical missing piece.** Winning Polymarket positions are held as conditional tokens (CTF ERC-1155). Without an active redemption step, realized profits sit unclaimed on-chain.

#### 2.1 — Resolution tracking
- Poll Gamma API for markets where `resolved: true` and `winner` is set
- Match against open `trades.jsonl` entries with `venue: "polymarket"`
- Record in `resolutions.jsonl` with `venue: "polymarket"`, computed P&L and Brier score
- Mirror structure of Manifold `pnpm resolve` — add Polymarket check to the same command

#### 2.2 — CTF token redemption
- On resolution, call the CTF Exchange contract's `redeemPositions()` to convert winning tokens → USDC
- Requires MATIC for gas (small, ~$0.01/redemption on Polygon)
- Add `pnpm redeem:poly` — sweeps all redeemable positions
- Reference: [polymarket-cli](https://github.com/Polymarket/polymarket-cli) `ctf redeem` as implementation guide for contract interaction

#### 2.3 — Risk limits
- Daily loss limit: halt trading if realized + unrealized loss > $X in 24h
- Kill switch env var: `POLY_TRADING_ENABLED=false` stops all order placement without code change
- Per-run exposure cap: don't exceed N open positions simultaneously

### Phase 3: Fast Training Loop — 🔲 Not Started

**Goal:** 500+ resolved bets per week. The calibration loop is only as good as its data.

#### 3.1 — Sports-first strategy
NBA dominates Polymarket's fast-resolution supply (447 markets/48h, $16.7M volume).
- Smaller bets ($5-10) spread across 50+ daily markets instead of $25 on 20
- ESPN odds as a strong prior alongside Claude
- Track: ESPN-implied-prob vs. Polymarket price vs. actual outcome per game

#### 3.2 — Category tagging
- Auto-tag each trade: sports / crypto / politics / tech / economics / other
- Per-category calibration: separate Brier scores, win rates, ROI
- Surface in `pnpm stats`

#### 3.3 — Kalshi integration
Strong on BTC/ETH daily price strikes ($691k vol) and economic data (Fed decisions $12.3M OI).
- Fetch Kalshi markets via their REST API
- Use exchange prices as probability input for crypto strikes
- Track economic consensus vs. market price for macro bets

#### 3.4 — Hourly monitoring for Polymarket
- Extend `pnpm monitor` to snapshot Polymarket open positions (currently Manifold only)
- Compute drift on poly positions: is market moving toward or away from our estimate?

### Phase 4: Category Intelligence — 🔲 Not Started

**Goal:** Learn which categories we're good at and concentrate there.

#### 4.1 — Per-category performance
- Scale bet sizes in categories with proven ROI after 50+ resolutions
- Reduce or skip categories with negative ROI
- "Sports with ESPN odds: 72% win rate. Politics without oracle: 41%."

#### 4.2 — Category-specific Claude feedback
- Inject category calibration into the prompt alongside global calibration
- Tailor enrichment: sports → ESPN odds, crypto → exchange prices, politics → Claude alone

### Phase 5: Autonomous Operation — 🔲 Not Started

**Goal:** The bot runs without human intervention.

#### Three-layer architecture

```
┌──────────────────────────────────────────────────────┐
│ HOT PATH — every 1-2 hours, no LLM                   │
│  cron → pnpm poly:scan (fetch, depth-check, execute) │
│       → pnpm monitor (snapshots, drift)              │
│       → pnpm redeem:poly (claim resolved winnings)   │
│  No LLM cost. Runs in seconds. 100+ markets/scan.    │
├──────────────────────────────────────────────────────┤
│ WARM PATH — every few hours, Claude agent            │
│  claude --headless "review cycle"                    │
│  → calibration review, param adjustment              │
│  → analyze edge cases, surface anomalies             │
│  → generate performance report                       │
├──────────────────────────────────────────────────────┤
│ COLD PATH — weekly, Claude agent team                │
│  Auditor: P&L deep-dive, systemic biases            │
│  Scout: new categories, data sources                 │
│  Engineer: codebase improvements                     │
│  Lead: synthesize, update strategy                   │
└──────────────────────────────────────────────────────┘
```

Cron setup:
```bash
*/90 * * * * cd ~/manifold-farmer && pnpm poly:scan >> /tmp/poly.log 2>&1
0 * * * *   cd ~/manifold-farmer && pnpm monitor >> /tmp/monitor.log 2>&1
0 */4 * * * cd ~/manifold-farmer && pnpm redeem:poly >> /tmp/redeem.log 2>&1
```

### Phase 6: Intelligent Position Management — 🔲 Not Started

- **Partial sells** on Polymarket: place SELL order on CLOB to exit early
- **Re-evaluation**: before selling, re-assess with updated data; hold if thesis intact
- **Correlation-aware trimming**: if multiple positions in correlated markets, trim to reduce concentration

---

## Manifold as Playground

Manifold remains useful for:
- **Experimentation**: test new strategies with play money before Polymarket
- **Long-tail markets**: unique questions that don't exist on Polymarket
- **Claude-only markets**: no structured data available, pure reasoning edge

Current Manifold performance (Feb 2026): 6 resolved, 14 open. 4W-2L, 67% win rate. 2 positions just sold at 70%+ of max payout.

---

## Tooling Reference

**[polymarket-cli](https://github.com/Polymarket/polymarket-cli)** — Official Rust CLI for Polymarket. Not used in the automated pipeline (we use the TypeScript SDK), but useful for:
- Manual market inspection and position checking during development
- **CTF redemption reference**: the `ctf redeem` command is the on-chain implementation guide for Phase 2.2
- Debugging: `polymarket-cli positions`, `polymarket-cli orders` with `-o json` output
- Approval management (alternative to `pnpm setup:poly`)

Note: the CLI defaults to POLY_PROXY signature type; our bot uses EOA (simpler for automation).

---

## Success Metrics

| Metric | Current | 30-day Target | 90-day Target |
|--------|---------|---------------|---------------|
| Resolved bets (all venues) | 6 | 2,000+ | 10,000+ |
| Bets per day | ~3 | 70+ | 150+ |
| Win rate | 67% | 55%+ | 58%+ |
| ROI (Manifold) | +86% | 8%+ | 12%+ |
| ROI (Polymarket) | — | 3%+ | 6%+ |
| Brier score | 0.254 | < 0.22 | < 0.18 |
| Venue coverage | 1 | 2 (+ Polymarket) | 3 (+ Kalshi) |
| Avg time to resolution | Days | < 24h | < 12h |
| Autonomous uptime | 0% | 80%+ | 95%+ |
