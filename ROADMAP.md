# Roadmap

## Vision

Build a dominant prediction market trading system that continuously improves through fast feedback loops. Trade on **Polymarket** (real money, deep liquidity, 1,300+ fast-resolution markets per 48h) using Manifold as a low-stakes playground for experimentation.

## Why Polymarket First

Market supply analysis (Feb 2026) showed:

| Platform | Markets resolving in 48h | Tradeable (>$10k liq) | 24h volume |
|----------|--------------------------|----------------------|------------|
| **Polymarket** | **~1,374** | **~600** | **$20.4M** |
| Kalshi | ~23,200 (mostly auto-generated parlays) | ~100 | ~$2M |
| Manifold | ~30 | ~5 | ~M$300k (play money) |

Polymarket has **45x the fast-resolution supply** of Manifold. NBA alone produces 447 markets per 48h with $16.7M daily volume. The training loop needs volume — Manifold can't supply it.

**Polymarket API**: `gamma-api.polymarket.com/markets` — public, no auth, returns prices/volume/liquidity. CLOB orderbook (not AMM), minimum order $5 USDC, tight spreads (0.1% on high-volume markets).

**Kalshi complement**: Strong on daily BTC/ETH price strikes ($691k daily vol) and monthly economic data (Fed decisions at $12.3M OI, CPI, PCE). Narrow but deep.

---

## Core Principles

### 1. Fast Feedback Loops

Every resolution is a calibration data point. A market that resolves in 2 hours is 360x more valuable than one that resolves in 30 days.

| Timescale | Signal | Source |
|-----------|--------|--------|
| **Minutes** | Fill quality, slippage vs. expected | Trade execution logs |
| **Hourly** | Did the market move toward or away from our estimate? | Position snapshots |
| **Daily** | Are our open positions trending profitable or losing? | Aggregate snapshot P&L |
| **Weekly** | Which categories and confidence levels are performing? | Resolution-based calibration |

### 2. Data Density Over Data Volume

Record the full context for every bet — not just the decision, but what data informed it, what calibration feedback was active, what the oracle price was. When reviewing performance, we can ask: "Do bets with ESPN odds data outperform those without?" or "Where does the oracle disagree with Claude?"

### 3. Closed-Loop Correction

Performance data flows back into decisions automatically:

```
bet → snapshot → analyze drift → update strategy params → better bet
       ↑                                                       |
       └───────────────────────────────────────────────────────┘
```

### 4. Measure Everything, Trust Nothing

Track ROI by category, confidence level, data source, time of day, market age. If a signal doesn't correlate with outcomes after 50+ bets, remove it.

### 5. Fail Fast, Learn Cheap

Start with small bets on uncertain categories to gather data. Scale up only on categories with proven positive ROI. Every loss should produce more learning signal than the dollars it cost.

---

## Implementation Phases

### Phase 0: Production Hardening (Now)

**Goal:** Make the bot reliable enough for autonomous operation.

- [x] Request timeouts on all fetch calls (30s default)
- [x] CI/CD — GitHub Actions for typecheck on PRs
- [ ] Retry with exponential backoff on transient API errors
- [ ] Extract shared P&L calculation module (currently duplicated 3x)
- [ ] Add tests for core math (Kelly, P&L, calibration)

### Phase 1: Polymarket Integration (Week 1)

**Goal:** Fetch Polymarket markets and use their prices as probability estimates.

#### 1.1 — Polymarket client (`src/polymarket.ts`)
- Fetch markets from `gamma-api.polymarket.com/markets`
- Parse `outcomePrices`, `volume`, `liquidity`, `endDate`, `tags`
- Filter to fast-resolution binary markets (endDate within 7 days, volume > $10k)

#### 1.2 — Market matcher (`src/market-matcher.ts`)
- Match Polymarket ↔ Manifold questions by keyword overlap
- Start simple: normalized keyword intersection score
- Require manual confirmation threshold (>0.8 similarity) for auto-matching

#### 1.3 — Oracle scan command (`pnpm scan:oracle`)
- For matched markets: use Polymarket price as probability estimate
- Compute edge = |polyPrice - manifoldPrice|
- Kelly sizing using Polymarket price as "true" probability
- Place bets on Manifold, log Polymarket reference price alongside

#### 1.4 — Oracle performance tracking
- Record `polymarketPrice` in every trade record
- After resolution: compare oracle accuracy vs. Claude accuracy
- Track: does betting Manifold toward Polymarket price actually profit?

### Phase 2: Polymarket Trading (Week 2-3)

**Goal:** Trade directly on Polymarket with real USDC.

#### 2.1 — Polymarket CLOB client
- Authenticate with Polymarket API (API key + wallet signing)
- Place limit orders on the CLOB (not market orders — control slippage)
- Monitor fills, cancels, partial fills

#### 2.2 — Venue abstraction
- Common interface for market fetching, bet placement, position tracking
- `Venue` interface: `fetchMarkets()`, `placeBet()`, `getPositions()`, `checkResolutions()`
- Implementations: `ManifoldVenue`, `PolymarketVenue`, later `KalshiVenue`

#### 2.3 — Cross-venue strategy
- Use Polymarket prices to bet mispriced Manifold markets (oracle approach)
- Use ESPN/finance data to bet mispriced Polymarket sports/stock markets (data edge)
- Use Claude for markets where no structured data exists (reasoning edge)

#### 2.4 — Risk management for real money
- Position limits per market (max $100 initially)
- Daily loss limit (max $500/day)
- Portfolio concentration limits (no >10% in correlated markets)
- Kill switch: stop all trading if daily loss exceeds threshold

### Phase 3: Fast Training Loop (Week 3-4)

**Goal:** 500+ resolved bets per week. Maximize calibration data points.

#### 3.1 — Sports-first strategy
NBA dominates Polymarket's fast-resolution supply (447 markets/48h, $16.7M volume). Target:
- Every NBA game daily (10-15 games × multiple markets per game)
- Use ESPN odds as probability estimates
- Small bet sizes ($5-20) to spread across 50+ daily bets
- Track: moneyline-implied-prob vs. Polymarket price vs. actual outcome

#### 3.2 — Crypto daily markets
Kalshi has BTC/ETH daily price strike markets ($691k daily volume). Target:
- Daily BTC/ETH price brackets
- Use exchange data as probability input
- 40-90 strike prices per daily snapshot = many bets per day

#### 3.3 — Economic data releases
Monthly but high-volume: Fed decisions ($12.3M OI), CPI, PCE, jobs reports. Target:
- Track consensus estimates vs. market prices
- Bet when market diverges from economist consensus
- Small number of bets but high confidence

#### 3.4 — Hourly monitoring
- Record position snapshots for all open bets
- Compute drift: `(currentProb - entryProb) × direction_sign`
- Track rolling agreement rate (% of positions with positive drift)
- Inject drift feedback into strategy: if agreement < 40%, be less contrarian

### Phase 4: Category Intelligence (Week 4-5)

**Goal:** Learn which categories we're good at and focus there.

#### 4.1 — Per-category calibration
- Auto-tag each bet with category (sports/crypto/politics/tech/economics)
- Compute separate Brier scores, ROI, win rates per category
- Track which data sources correlate with wins per category

#### 4.2 — Category-specific strategy
- Scale up bet sizes in categories with proven ROI
- Reduce or skip categories with negative ROI after 50+ bets
- Tailor strategy per category (e.g., sports = odds data, crypto = exchange prices)

#### 4.3 — Feedback loop
- Inject category-specific calibration into Claude's prompt for warm-path analysis
- "Sports with ESPN odds: 72% win rate. Politics without oracle: 41%. Only bet politics when oracle available."

### Phase 5: Autonomous Operation (Week 5-6)

**Goal:** The bot runs without human intervention.

#### Three-layer architecture

```
┌──────────────────────────────────────────────────────┐
│ HOT PATH — every 1-2 hours, pure code, no LLM        │
│                                                       │
│  cron → fetch Polymarket/Kalshi/ESPN prices           │
│       → fetch Manifold/Polymarket markets             │
│       → match and compute edge                        │
│       → Kelly sizing → execute bets                   │
│       → record snapshots, check resolutions           │
│                                                       │
│  No LLM cost. Runs in seconds. 100+ markets/scan.    │
├──────────────────────────────────────────────────────┤
│ WARM PATH — every few hours, single Claude Code agent │
│                                                       │
│  cron → claude --headless "review cycle"              │
│       → review calibration data, adjust params        │
│       → analyze non-oracle markets with Claude        │
│       → generate performance report                   │
│                                                       │
│  Opus-level reasoning on strategy.                    │
├──────────────────────────────────────────────────────┤
│ COLD PATH — weekly, Claude Code agent team            │
│                                                       │
│  manual or cron → multi-agent strategy review         │
│       → Auditor: P&L deep-dive, systemic biases      │
│       → Scout: new categories, data sources           │
│       → Engineer: codebase improvements               │
│       → Lead: synthesize, update strategy             │
│                                                       │
│  Deep analysis. Codebase improvements.                │
└──────────────────────────────────────────────────────┘
```

#### 5.1 — Hot path cron
```bash
*/90 * * * * cd ~/manifold-farmer && pnpm scan:oracle >> /tmp/hot.log 2>&1
0 * * * *   cd ~/manifold-farmer && pnpm monitor >> /tmp/monitor.log 2>&1
```

#### 5.2 — Warm path agent
```bash
0 */4 * * * cd ~/manifold-farmer && claude --headless -p "Run review cycle" >> /tmp/warm.log 2>&1
```

#### 5.3 — Cold path agent team
```bash
# Weekly — deep strategy review
0 6 * * 1 cd ~/manifold-farmer && claude --headless -p "Weekly strategy review" >> /tmp/cold.log 2>&1
```

### Phase 6: Intelligent Position Management (Week 6+)

**Goal:** Trim positions intelligently rather than binary sell-all.

- **Partial sells**: At 50% of max payout sell 30%, at 70% sell another 40%, let 30% ride
- **Re-evaluation**: Before selling, re-assess with updated data. Hold if thesis intact.
- **Correlation-aware trimming**: If multiple positions in correlated markets, trim to reduce concentration.

---

## Manifold as Playground

Manifold remains valuable for:
- **Experimentation**: Test new strategies with play money before deploying to Polymarket
- **Long-tail markets**: Unique markets that don't exist on Polymarket (tech predictions, niche politics)
- **Oracle validation**: Compare Polymarket prices against Manifold to validate the oracle approach
- **Claude as forecaster**: Markets without structured data where Opus-level reasoning is the edge

Current Manifold performance (6 resolved, 12 open):
- 4W-2L, 67% win rate, +M$129 realized
- Sports: 80% win rate, +123% ROI (best category)
- +M$110 unrealized across open positions

---

## Success Metrics

| Metric | Current | 30-day Target | 90-day Target |
|--------|---------|---------------|---------------|
| Resolved bets (all venues) | 6 | 2,000+ | 10,000+ |
| Bets per day | ~3 | 70+ | 150+ |
| Win rate | 67% | 55%+ | 58%+ |
| ROI (Manifold) | +86% | 8%+ | 12%+ |
| ROI (Polymarket) | N/A | 3%+ | 6%+ |
| Brier score | 0.254 | < 0.22 | < 0.18 |
| Venue coverage | 1 | 2 (Manifold + Poly) | 3 (+Kalshi) |
| Avg time to resolution | Days | < 24 hours | < 12 hours |
| Autonomous uptime | 0% | 80%+ | 95%+ |

Note: Polymarket ROI targets are lower because prices are sharper (less mispricing). But the volume makes even 3% ROI significant at scale.

---

## Data Architecture

```
data/
├── decisions.jsonl     # Every market analyzed
├── trades.jsonl        # Every bet placed (all venues)
├── resolutions.jsonl   # Final outcomes
├── snapshots.jsonl     # Hourly position snapshots
├── polymarket.jsonl    # Polymarket reference prices at bet time
└── daily-reports/      # Agent-generated performance reports
```

All append-only JSONL. Linked by `traceId` across files. Each trade record includes `venue: "manifold" | "polymarket" | "kalshi"` for cross-venue analysis.
