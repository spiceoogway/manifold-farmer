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

### Phase 6: Polymarket Consideration (Future)

**Goal:** Evaluate whether the more adversarial environment is worth the higher liquidity.

#### Pros
- Much higher liquidity = bigger positions possible
- Real-money markets = stronger price signal
- More markets, especially current events

#### Cons
- More sophisticated traders = less mispricing
- Need to manage real crypto (USDC)
- API is more complex (CLOB vs. AMM)
- Regulatory considerations

#### Prerequisites before switching
- Proven positive ROI on Manifold over 100+ resolved bets
- Category-level intelligence working (know where we have edge)
- Robust position management (partial sells, stop losses)
- Confidence that our edge is real, not just Manifold noise

#### Hybrid approach
Run both simultaneously:
- Manifold for learning and data collection (low stakes, fast iteration)
- Polymarket for proven strategies only (higher stakes, less experimentation)

---

## Recommended Run Cadences

| Command | Frequency | Purpose |
|---------|-----------|---------|
| `pnpm monitor` | Every 1 hour | Record snapshots, check resolutions, compute drift |
| `pnpm scan` | Every 6 hours | Find and enter new positions |
| `pnpm sell` | Every 4 hours | Evaluate positions for trimming |
| `pnpm stats` | On demand | Review calibration and performance |

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

---

## Agent Architecture: Claude Code as the Forecaster

### Current: Static Pipeline
```
search → Claude API (Sonnet, fixed prompt) → Kelly sizing → execute
```
Problems:
- Anthropic API key dependency (single point of failure)
- Fixed system prompt can't adapt in real-time
- Sonnet is less capable than Opus for complex reasoning
- No context across bets (each call is independent)

### Target: Claude Code as the Agent
```
User says "run scan" → Claude Code (Opus) does:
  1. Fetches markets via Manifold API
  2. Fetches finance/sports data
  3. Reads calibration data and past performance
  4. Reasons about each market with full context
  5. Applies Kelly sizing
  6. Places bets and records everything
```
Advantages:
- Opus-level reasoning (better than Sonnet on complex markets)
- Full context: sees past bets, calibration data, current portfolio
- Can adapt strategy in real-time based on conversation
- No separate API key needed
- Can explain reasoning interactively

### Future: Agent Teams (Experimental)
When Claude Code agent teams stabilize, consider:
- **Market Scout**: searches across multiple sort orders, classifies by resolution speed
- **Analyst**: estimates probabilities with full context and data tools
- **Portfolio Manager**: monitors positions, computes drift, decides trims
- **Lead**: coordinates the team, synthesizes findings, makes final calls

Agent teams are best for development sprints (improving the codebase in parallel) rather than runtime execution. For runtime, the single-agent approach (Claude Code as forecaster) is more practical and cost-effective.

### Run Modes
1. **Interactive** (current): User asks Claude Code to "run scan" / "run monitor" / "run sell"
2. **Semi-autonomous**: Claude Code runs the full cycle on request, reports results, asks for approval before executing
3. **Autonomous** (future): Scheduled execution via cron calling Claude Code headless, with human review of decisions log
