# Self-Improvement Roadmap

## Goal

Build a prediction market bot that continuously improves its forecasting quality and P&L through fast feedback loops, rich data collection, and closed-loop correction.

## North Star: Fast Resolution Markets

**The #1 priority is maximizing resolved bets per unit time.** Every resolution is a calibration data point. A market that resolves in 2 days is 15x more valuable for training than one that resolves in 30 days.

Fast-resolution markets include:
- **Sports game outcomes** — resolve in hours (NBA, NHL, NFL, MLB, UFC)
- **Stock/commodity price targets** — resolve on specific dates
- **Earnings announcements** — resolve on earnings date
- **"By end of [date]" markets** — explicit near-term deadlines
- **Daily markets** — resolve next day

The bot should systematically prioritize these over long-horizon markets. The `resolutionSpeedScore()` in strategy.ts ranks markets by expected resolution speed, and `filterMarkets()` returns candidates sorted fastest-first.

**Target: 500+ resolved bets per week within 30 days.**

This requires ~70+ bets per day. The strategy:
- **Sports markets**: 10-15 NBA/NHL/MLB games daily, each with Manifold markets. ESPN odds data gives us an edge on every game.
- **Stock/commodity markets**: Multiple stock price and earnings markets resolve daily.
- **Daily/fast-closing markets**: Sweep every binary market closing within 48 hours where we can form an estimate.
- **Smaller bet sizes**: M$5-20 per bet to spread bankroll across 70+ daily bets (Kelly still applies).
- **Higher scan frequency**: Run scan 4-6x per day with multiple search queries per scan.
- **Automated pipeline**: This volume is only possible with a fully automated scan→analyze→bet loop.

## Core Principles

### 1. Fast Feedback Loops

Don't wait for market resolution (weeks/months) to learn. Extract signal at every timescale:

| Timescale | Signal | Source |
|-----------|--------|--------|
| **Hourly** | Did the market move toward or away from our estimate? | Position snapshots |
| **Daily** | Are our open positions trending profitable or losing? | Aggregate snapshot P&L |
| **Weekly** | Which categories and confidence levels are performing? | Snapshot-based calibration |
| **On resolution** | Final P&L, Brier score, win/loss | Resolution records |

The key insight: **market movement after our bet is a fast proxy for forecast accuracy**. If we estimate 75% and the market moves from 60% to 70%, that's confirming signal within hours — we don't need to wait months for resolution.

### 2. Data Density Over Data Volume

Every bet should maximize learning signal. Record not just the decision, but the full context:

- What data tools returned (finance prices, sports odds)
- Claude's full reasoning chain
- Market description and metadata
- Calibration feedback that was active at decision time

When reviewing performance, we can then ask: "Do bets with finance data outperform those without?" or "Which reasoning patterns correlate with wins?"

### 3. Closed-Loop Correction

Performance data must flow back into decisions automatically:

```
bet → snapshot → analyze drift → update feedback → better bet
         ↑                                              |
         └──────────────────────────────────────────────┘
```

Currently: calibration feedback after resolution (slow loop).
Target: drift-based feedback after hours (fast loop) + resolution feedback (accurate loop).

### 4. Measure Everything, Trust Nothing

- Track ROI by category, confidence level, data tool presence, time of day, market age
- Don't assume any rule is working — validate with data
- A/B test implicitly: Claude's confidence labels are a built-in hypothesis ("high" confidence should outperform "medium")
- If a signal doesn't correlate with outcomes after 50+ bets, remove it

### 5. Fail Fast, Learn Cheap

- Start with small bets on uncertain categories to gather data
- Scale up sizing only on categories with proven positive ROI
- Trim losing positions early rather than hoping for recovery
- Every loss should produce more learning signal than the M$ it cost

---

## Implementation Phases

### Phase 1: Hourly Monitoring (Now)

**Goal:** Get feedback every hour instead of waiting for resolution.

#### 1.1 — `monitor` command
Create a lightweight CLI command that:
- Records position snapshots for all open bets (already implemented in resolve)
- Computes aggregate portfolio metrics (total unrealized P&L, drift direction)
- Optionally checks for new resolutions

This should run every hour. Current `resolve` already does this but we can make a dedicated lighter path.

**Run cadence:** Every 1 hour

#### 1.2 — Estimate drift tracking
For each snapshot, compute:
```
drift_score = (currentProb - entryProb) × direction_sign
```
Where `direction_sign = +1` for YES bets, `-1` for NO bets.

Positive drift = market moving toward our position = confirming signal.

Track rolling average drift score. If systematically negative, Claude is betting against the crowd and the crowd is right.

#### 1.3 — Drift-based feedback
After accumulating 24+ hours of snapshots per position:
- Compute "market agreement rate" — what % of positions have positive drift?
- If agreement rate < 40%: inject feedback "Markets are consistently moving against your estimates. Be less contrarian."
- If agreement rate > 70%: positions are confirming, current approach is working

### Phase 2: Rich Context Logging (Week 1)

**Goal:** Record everything needed to diagnose why bets win or lose.

#### 2.1 — Log data tool responses
Store the actual finance/sports context that was fed to Claude alongside each decision. Currently we pass it to Claude but don't persist it.

Add to TradeDecision:
```typescript
dataToolContext?: string;  // what finance/sports tools returned
```

#### 2.2 — Log active calibration feedback
Store what calibration feedback was active when each decision was made. Lets us measure whether feedback is actually improving decisions.

Add to TradeDecision:
```typescript
calibrationFeedbackActive?: boolean;
feedbackVersion?: number;  // increment each time feedback changes
```

#### 2.3 — Category tagging
Auto-tag each decision with a category (politics, tech, sports, finance, etc.) using the keyword classifier from market-analysis.ts. Enables per-category performance tracking.

Add to TradeDecision:
```typescript
category?: string;
```

### Phase 3: Category-Level Intelligence (Week 2)

**Goal:** Learn which market categories we're good at and focus there.

#### 3.1 — Per-category calibration
Extend calibration.ts to compute separate reports per category:
- Which categories have positive ROI?
- Which categories have the best Brier scores?
- Where are we over/under-confident by category?

#### 3.2 — Category-specific feedback
Instead of generic "you're overconfident in 60-70%", tell Claude:
- "On politics markets, you're overconfident by ~15pts. On tech markets, you're well-calibrated."
- "Sports markets with odds data: 72% win rate. Without: 41%. Only bet sports with data."

#### 3.3 — Category-based market selection
Prioritize scanning categories with proven positive ROI. Deprioritize or skip categories where we consistently lose.

### Phase 4: Intelligent Position Management (Week 3)

**Goal:** Trim positions intelligently rather than binary sell-all.

#### 4.1 — Partial sells
Instead of selling entire position at thresholds, trim proportionally:
- At 50% of max payout: sell 30% of position
- At 70% of max payout: sell another 40%
- Let remaining 30% ride to resolution

#### 4.2 — Re-evaluation sells
Before selling, re-run Claude on the market with updated data. If Claude's new estimate still supports the position, hold. If estimate has flipped, sell.

#### 4.3 — Correlation-aware trimming
If multiple positions are in correlated markets (e.g., two NVIDIA markets), trim one when the other confirms to reduce concentration risk.

### Phase 5: Broader Market Coverage (Week 4)

**Goal:** Find more edge by searching more markets.

#### 5.1 — Expand search
Currently fetching top 50 markets by liquidity. Expand to:
- Multiple search queries (by category keywords)
- Different sort orders (newest, closing soon, trending)
- Target 200+ candidates per scan, filter down to 20 for Claude analysis

#### 5.2 — Pre-filter with heuristics
Before spending Claude API calls, score markets by:
- Liquidity (higher = more reliable prices)
- Bettor count (fewer = more likely mispriced)
- Category (prefer categories with proven ROI)
- Time to close (sweet spot: 1-4 weeks)

#### 5.3 — Track opportunity cost
Log markets we skipped. Periodically check: would we have been right? Helps calibrate our filter thresholds.

### Phase 6: Polymarket Price Oracle (Week 4-5)

**Goal:** Use Polymarket's real-money prices as a "true probability" oracle to find mispriced Manifold markets — no LLM needed for the core loop.

#### The Insight

Polymarket is a real-money prediction market with sophisticated traders and deep liquidity. Its prices are among the best publicly available probability estimates. Manifold is a play-money market with softer prices and frequent mispricing. When the same question exists on both platforms, the price gap is often exploitable.

Example found in exploration: Iran strike market — Polymarket 4%, Manifold 20%. That's a 16-point gap on a well-traded event.

#### Architecture: `src/polymarket-tool.ts`

```typescript
// 1. Fetch Polymarket markets
//    GET https://gamma-api.polymarket.com/markets
//    Public API, no auth needed. Returns outcomePrices, volume, liquidity.

// 2. Match to Manifold markets
//    Keyword + semantic matching on question text.
//    Start simple (exact keyword overlap), improve with embeddings later.

// 3. Compute cross-market edge
//    edge = |polyPrice - manifoldPrice|
//    direction = bet Manifold toward Polymarket price
//    Only bet when edge > threshold AND Polymarket volume > $50k (confident price)

// 4. Size with Kelly, using Polymarket price as the "true" probability
```

#### Why This Changes Everything

- **No LLM needed in the hot path.** The Polymarket price IS the estimate. Pure code: fetch prices, compare, bet, log.
- **Edge is structural, not analytical.** Real money vs. play money creates persistent mispricing.
- **Massive throughput.** Without Claude API calls, we can scan hundreds of markets per minute.
- **Perfect for fast-resolution markets.** Sports and daily markets exist on both platforms.
- **Measurable ground truth.** Track: does betting Manifold toward Polymarket price actually profit? The data will tell us within days.

#### Implementation Steps

1. **`src/polymarket-tool.ts`** — Fetch and parse Polymarket markets from gamma API
2. **`src/market-matcher.ts`** — Match Polymarket ↔ Manifold questions by keywords
3. **Update `scan` pipeline** — Add Polymarket oracle as a probability source alongside Claude
4. **Track oracle performance** — Log polymarket price alongside each bet, measure oracle accuracy vs. Claude accuracy on resolved bets
5. **Graduate** — Once oracle outperforms Claude on matched markets, make it the default for those categories

#### Polymarket as Training Data

Even on markets without a Manifold match, Polymarket prices serve as calibration:
- Compare our Claude estimates to Polymarket prices as a "fast Brier score"
- No need to wait for resolution — Polymarket price is the benchmark
- Enables daily calibration feedback instead of waiting weeks for resolutions

#### Future: Trading Polymarket Directly

Once we have proven edge and category intelligence:
- Trade Polymarket directly for real USD returns
- Use Manifold as the learning/experimentation sandbox
- Run both simultaneously: Manifold for data, Polymarket for profit

---

## Recommended Run Cadences

### Current (Interactive)

| Command | Frequency | Purpose |
|---------|-----------|---------|
| `pnpm monitor` | Every 1 hour | Record snapshots, check resolutions, compute drift |
| `pnpm scan` | Every 6 hours | Find and enter new positions (Claude or oracle) |
| `pnpm sell` | Every 4 hours | Evaluate positions for trimming |
| `pnpm stats` | On demand | Review calibration and performance |

### Target (Autonomous)

| Layer | Command | Frequency | Purpose |
|-------|---------|-----------|---------|
| Hot | `pnpm scan:oracle` | Every 90 min | Oracle-based scan + bet (no LLM) |
| Hot | `pnpm monitor` | Every 1 hour | Snapshots, resolutions, drift |
| Hot | `pnpm sell` | Every 4 hours | Position trimming |
| Warm | `claude --headless` | Daily | Strategy review, param tuning |
| Cold | `claude --headless` (agent team) | Weekly | Deep audit, codebase improvements |

---

## Success Metrics

| Metric | Current | 30-day Target | 90-day Target |
|--------|---------|---------------|---------------|
| Resolved bets | 3 | 2,000+ | 10,000+ |
| Bets per day | ~3 | 70+ | 150+ |
| Win rate | ~67% | 55%+ | 58%+ |
| ROI | ~53% | 8%+ | 12%+ |
| Brier score | TBD | < 0.22 | < 0.18 |
| Hourly drift agreement | TBD | > 55% | > 60% |
| Category coverage | 1-2 | 8+ | 12+ |
| Avg time to resolution | Weeks | < 48 hours | < 24 hours |
| Calibration data points | 3 | 2,000+ | 10,000+ |

Note: ROI will decrease from 53% at scale — current number is from a small sample with favorable variance. At 70+ bets/day, even 8% ROI compounds significantly. The real value is the calibration data: 2,000+ resolved bets gives us statistically meaningful signals for every category, confidence level, and strategy parameter.

---

## Data Architecture

```
data/
├── decisions.jsonl     # Every market analyzed (116 records)
├── trades.jsonl        # Every bet placed (44 records)
├── resolutions.jsonl   # Final outcomes (3 records)
└── snapshots.jsonl     # Hourly position snapshots (growing)
```

All append-only JSONL. Linked by `traceId` across files.

Future additions:
- `drift.jsonl` — Computed drift scores per position per snapshot
- `categories.jsonl` — Market category assignments and per-category metrics
- `polymarket.jsonl` — Polymarket prices at time of each Manifold bet (oracle reference)
- `daily-reports/` — Natural language daily reports from warm path agent

---

## Autonomous Loop Architecture

The bot needs to run without human intervention. The key insight: **with a Polymarket oracle, the high-frequency execution path doesn't need an LLM at all.** This changes the architecture from "how do we run Claude autonomously" to "how do we split work between code (fast, cheap) and agents (smart, expensive)."

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│ HOT PATH — every 1-2 hours, pure code, no LLM           │
│                                                          │
│  cron → fetch Polymarket prices                         │
│       → fetch Manifold markets                          │
│       → match questions                                 │
│       → compute edge (poly price vs manifold price)     │
│       → Kelly sizing                                    │
│       → execute bets                                    │
│       → record snapshots                                │
│       → check resolutions                               │
│       → log everything                                  │
│                                                          │
│  No LLM cost. Runs in seconds. Handles 100+ markets.   │
├─────────────────────────────────────────────────────────┤
│ WARM PATH — daily, single Claude Code agent              │
│                                                          │
│  cron → claude --headless "run daily review"            │
│       → reviews calibration data from hot path          │
│       → analyzes non-oracle markets (Claude estimates)  │
│       → adjusts edge thresholds, bet sizing params      │
│       → identifies new market categories to explore     │
│       → generates natural-language performance report   │
│                                                          │
│  ~$0.50-2/day. Opus-level reasoning on strategy.        │
├─────────────────────────────────────────────────────────┤
│ COLD PATH — weekly, Claude Code agent team               │
│                                                          │
│  manual or cron → claude --headless with CLAUDE.md      │
│       → multi-agent strategy review                     │
│       → one agent: audit P&L, find systemic biases      │
│       → one agent: research new market categories       │
│       → one agent: review + improve codebase            │
│       → lead agent: synthesize, update config/strategy  │
│                                                          │
│  ~$5-10/week. Deep analysis, codebase improvements.     │
└─────────────────────────────────────────────────────────┘
```

### Hot Path: Cron + Pure Code

The volume play. Runs every 1-2 hours via cron, no human interaction.

**Implementation:**
```bash
# crontab
*/90 * * * * cd ~/manifold-farmer && pnpm scan:oracle >> /tmp/manifold-hot.log 2>&1
0 * * * *   cd ~/manifold-farmer && pnpm monitor >> /tmp/manifold-monitor.log 2>&1
```

**What it does:**
1. Fetches Polymarket markets from gamma API
2. Fetches Manifold markets (multiple sort orders, keywords)
3. Matches questions across platforms
4. For matched markets: uses Polymarket price as probability estimate
5. For sports markets: uses ESPN/odds data as probability estimate
6. Computes edge, Kelly sizes, places bets
7. Records snapshots, checks resolutions, logs everything

**What it does NOT do:**
- No LLM calls — probability comes from oracle prices and data tools
- No complex reasoning — just price comparison and math
- No strategy changes — runs with fixed parameters until warm path adjusts them

### Warm Path: Daily Agent Review

Strategy layer. Runs once per day via `claude --headless`.

**Implementation:**
```bash
# crontab — daily at 6 AM
0 6 * * * cd ~/manifold-farmer && claude --headless -p "Run daily review. Read calibration data, analyze performance, suggest parameter adjustments. Write report to data/daily-reports/" >> /tmp/manifold-warm.log 2>&1
```

**What it does:**
1. Reads all JSONL data (decisions, trades, resolutions, snapshots)
2. Computes calibration metrics, drift analysis, category performance
3. Identifies markets where no oracle exists — applies Opus-level reasoning
4. Adjusts parameters: edge thresholds, max bet sizes, category weights
5. Writes config changes and natural-language report

**Key value:** The warm path catches things code can't:
- "Sports markets are 2x more profitable than politics — increase sports allocation"
- "Our edge threshold of 5% is too aggressive — losses on thin-edge bets are dragging ROI"
- "New market category 'AI releases' has no oracle match but Claude estimates are 70% accurate — keep betting"

### Cold Path: Weekly Agent Team

Deep strategy review. Runs weekly, potentially with Claude Code agent teams.

**Agent roles:**
| Agent | Task |
|-------|------|
| **Auditor** | Deep-dive into P&L. Find systemic biases, losing patterns, category-level issues. |
| **Scout** | Research new market categories, new data sources, new oracle opportunities. |
| **Engineer** | Review and improve codebase — new features, bug fixes, performance. |
| **Lead** | Synthesize findings from all agents. Update ROADMAP.md, strategy params, priorities. |

**Implementation with Claude Code agent teams:**
```bash
claude --headless -p "Weekly strategy review. Coordinate with subagents to audit performance, scout new opportunities, and improve the codebase." --allowedTools "Task,Read,Write,Edit,Bash,Glob,Grep"
```

Agent teams are best suited here because:
- The work is parallelizable (audit, scout, engineer can work independently)
- Each agent needs deep context in its domain
- The lead synthesizes across domains — a natural coordinator role
- Weekly cadence means the cost (~$5-10) is justified by the depth of analysis

### Migration Path

| Phase | Execution | When |
|-------|-----------|------|
| **Now** | Interactive: user tells Claude Code what to do | Current |
| **Phase 6** | Hot path: cron runs oracle-based scan + monitor | After Polymarket oracle works |
| **Phase 7** | Warm path: daily `claude --headless` reviews | After 100+ oracle-based resolutions |
| **Phase 8** | Cold path: weekly agent team strategy review | After warm path proves value |

### Why Not Full-Agent Autonomous?

Running Claude for every bet decision is:
- **Expensive**: ~$0.05-0.15 per market analysis × 200 markets/scan × 6 scans/day = $60-180/day
- **Slow**: Each Claude call takes 5-30 seconds, serial bottleneck
- **Unnecessary**: With a Polymarket oracle, the estimate is already available for free

The three-layer approach uses Claude where it adds value (strategy, reasoning about novel markets, codebase improvement) and pure code where it doesn't (price comparison, bet execution, data recording).
