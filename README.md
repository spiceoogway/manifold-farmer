# manifold-farmer

Prediction market trading bot. Trades on [Polymarket](https://polymarket.com) (real USDC) and [Manifold Markets](https://manifold.markets) (play money). Uses Claude to estimate probabilities, Kelly criterion to size bets, and tracks calibration over time to improve.

## How it works

1. **Scan** — Fetches open binary markets, enriches with real-time data (stock prices via Yahoo Finance, sports odds via ESPN), estimates probabilities with Claude, sizes bets using Kelly criterion, places orders.
2. **Monitor** — Records hourly position snapshots, checks for resolutions, computes drift (are markets moving toward or against our estimates?).
3. **Sell** — Evaluates open Manifold positions for trimming based on unrealized P&L and payout ratios.
4. **Resolve** — Checks resolved markets, records outcomes, computes Brier scores and P&L.
5. **Stats** — Prints calibration report: win rate, ROI, Brier score, per-confidence breakdown.

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env — minimum required: ANTHROPIC_API_KEY
```

## Commands

```bash
# Polymarket (primary — real USDC)
pnpm poly:scan   # Fetch Polymarket markets, analyze with Claude, place USDC orders

# Manifold (play money)
pnpm scan        # Find and enter new positions
pnpm monitor     # Hourly portfolio check — snapshots, resolutions, drift
pnpm sell        # Evaluate positions for trimming
pnpm resolve     # Check for market resolutions
pnpm stats       # Print calibration report
```

## Architecture

```
Polymarket pipeline (pnpm poly:scan)
  Gamma API → filter (binary, <7d, vol≥$1k, liq≥$5k)
    → Claude estimate → Kelly sizing → FOK order via CLOB SDK

Manifold pipeline (pnpm scan)
  Manifold search API → filter binary CPMM markets
    → Claude estimate → Kelly + AMM slippage → REST bet

Both pipelines share: analyzer, strategy, executor, calibration
All trades stored as append-only JSONL in data/, linked by traceId
```

```
src/
├── index.ts          # CLI dispatcher
├── config.ts         # Environment config
├── types.ts          # Shared types
├── polymarket.ts     # Polymarket Gamma API + CLOB client
├── manifold.ts       # Manifold API client
├── analyzer.ts       # Claude probability estimation
├── strategy.ts       # Market filtering, edge calc, Kelly sizing
├── executor.ts       # Order/bet placement (dispatches by venue)
├── resolver.ts       # Resolution tracking + snapshots
├── seller.ts         # Position exit logic (Manifold)
├── calibration.ts    # Performance metrics (Brier, ROI, buckets)
├── feedback.ts       # Calibration → natural language for Claude
├── finance-tool.ts   # Yahoo Finance data enrichment
├── sports-tool.ts    # ESPN odds/scores enrichment
└── data.ts           # JSONL read/write utilities
```

## Configuration

### Minimum (dry run, Polymarket read-only)
```env
ANTHROPIC_API_KEY=sk-ant-...
DRY_RUN=true
```

### Polymarket live trading
```env
ANTHROPIC_API_KEY=sk-ant-...
DRY_RUN=false

POLY_PRIVATE_KEY=0x...          # Your Polygon wallet private key
# POLY_FUNDER_ADDRESS=0x...     # Only needed for POLY_PROXY sig type (see below)
POLY_SIGNATURE_TYPE=0           # 0=EOA (direct wallet), 1=POLY_PROXY
POLY_MAX_BET_AMOUNT=25          # Max USDC per order
```

**Wallet setup:** Deposit USDC to your Polygon wallet, then approve Polymarket's exchange contract. With `POLY_SIGNATURE_TYPE=0` (EOA), your wallet signs and funds orders directly — `POLY_FUNDER_ADDRESS` is not required. With `POLY_SIGNATURE_TYPE=1` (POLY_PROXY, how the Polymarket web app works), set `POLY_FUNDER_ADDRESS` to your Polymarket proxy wallet address (visible in the Polymarket UI under your account settings).

### Manifold live trading
```env
MANIFOLD_API_KEY=...
DRY_RUN=false
```

### All options
```env
ANTHROPIC_API_KEY=sk-ant-...
MANIFOLD_API_KEY=...            # Optional — only needed for pnpm scan

DRY_RUN=true
EDGE_THRESHOLD=0.10             # Min edge % to consider a bet
KELLY_FRACTION=0.25             # Fractional Kelly (1/4 Kelly)
MAX_POSITION_PCT=0.20           # Max % of bankroll per Manifold position
MAX_BET_AMOUNT=50               # Max mana per Manifold bet
MIN_LIQUIDITY=100               # Min Manifold market liquidity
MAX_MARKETS_PER_RUN=20          # Manifold markets to analyze per run
CLAUDE_MODEL=claude-sonnet-4-20250514

POLY_PRIVATE_KEY=0x...
POLY_FUNDER_ADDRESS=0x...
POLY_SIGNATURE_TYPE=0
POLY_MIN_VOLUME_24HR=1000       # Min 24h volume (USDC) to consider
POLY_MIN_LIQUIDITY=5000         # Min liquidity (USDC) to consider
POLY_MAX_MARKETS_PER_RUN=20
POLY_MAX_BET_AMOUNT=25          # Max USDC per order
```

## Data

All trade data stored as append-only JSONL in `data/`, linked by `traceId`:

```
data/
├── decisions.jsonl    # All analyzed markets + Claude reasoning
├── trades.jsonl       # All executed bets/orders (venue field: manifold|polymarket)
├── resolutions.jsonl  # Resolved outcomes + P&L
└── snapshots.jsonl    # Hourly position snapshots for drift analysis
```
