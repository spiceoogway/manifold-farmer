# manifold-farmer

Prediction market trading bot. Currently trades on [Manifold Markets](https://manifold.markets) (play money), with [Polymarket](https://polymarket.com) integration in progress.

## How it works

1. **Scan** — Fetches open binary markets, enriches with real-time data (stock prices via Yahoo Finance, sports odds via ESPN), estimates probabilities, and places bets using Kelly criterion with slippage-aware sizing.
2. **Monitor** — Records hourly position snapshots, checks for resolutions, computes drift (are markets moving toward or against our estimates?).
3. **Sell** — Evaluates open positions for trimming based on unrealized P&L and payout ratios.
4. **Resolve** — Checks resolved markets, records outcomes, computes Brier scores and P&L.
5. **Stats** — Prints calibration report: win rate, ROI, Brier score, per-confidence breakdown.

## Setup

```bash
pnpm install
cp .env.example .env
# Add your Manifold API key to .env
```

## Commands

```bash
pnpm scan      # Find and enter new positions
pnpm monitor   # Hourly portfolio check — snapshots, resolutions, drift
pnpm sell      # Evaluate positions for trimming
pnpm resolve   # Check for market resolutions
pnpm stats     # Print calibration report
```

## Architecture

```
src/
├── index.ts          # CLI dispatcher
├── config.ts         # Environment config
├── types.ts          # Shared types
├── manifold.ts       # Manifold API client
├── analyzer.ts       # Claude probability estimation
├── strategy.ts       # Market filtering, edge calc, Kelly sizing
├── executor.ts       # Bet placement
├── resolver.ts       # Resolution tracking + snapshots
├── seller.ts         # Position exit logic
├── calibration.ts    # Performance metrics (Brier, ROI, buckets)
├── feedback.ts       # Calibration → natural language for Claude
├── finance-tool.ts   # Yahoo Finance data enrichment
├── sports-tool.ts    # ESPN odds/scores enrichment
└── data.ts           # JSONL read/write utilities
```

All trade data stored as append-only JSONL in `data/`, linked by `traceId` across files.

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full plan. Key phases:

1. Production hardening (CI, timeouts) — done
2. Polymarket integration (oracle pricing, market matching)
3. Polymarket direct trading (CLOB client, venue abstraction)
4. Fast training loop (500+ resolved bets/week)
5. Category intelligence (per-category calibration)
6. Autonomous operation (hot/warm/cold path architecture)
