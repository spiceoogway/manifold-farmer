export interface Config {
  manifoldApiKey: string;
  anthropicApiKey: string;
  dryRun: boolean;
  edgeThreshold: number;
  kellyFraction: number;
  maxPositionPct: number;
  maxBetAmount: number;
  minLiquidity: number;
  maxMarketsPerRun: number;
  claudeModel: string;
  // Polymarket
  polyPrivateKey?: string;
  polyFunderAddress?: string;
  polySignatureType: number;
  polyMinVolume24hr: number;
  polyMinLiquidity: number;
  polyMaxMarketsPerRun: number;
  polyMaxBetAmount: number;
}

export interface ManifoldUser {
  id: string;
  username: string;
  balance: number;
}

export interface ManifoldMarket {
  id: string;
  question: string;
  description?: unknown;
  textDescription?: string;
  url: string;
  probability: number;
  totalLiquidity: number;
  volume: number;
  closeTime: number;
  createdTime: number;
  outcomeType: string;
  mechanism: string;
  isResolved: boolean;
  resolution?: string;
  resolutionProbability?: number;
  resolutionTime?: number;
  uniqueBettorCount?: number;
  creatorUsername: string;
}

export interface ClaudeEstimate {
  probability: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
}

export interface TradeDecision {
  traceId: string;
  timestamp: string;
  marketId: string;
  question: string;
  marketUrl: string;
  marketProb: number;
  estimate: number;
  confidence: string;
  reasoning: string;
  edge: number;
  direction: "YES" | "NO" | null;
  kellyFraction: number;
  effectiveProb: number;
  betAmount: number;
  action: "BET" | "SKIP_LOW_EDGE" | "SKIP_NEGATIVE_KELLY" | "SKIP_LOW_CONFIDENCE" | "SKIP_ERROR";
  venue: "manifold" | "polymarket";
  polyTokenId?: string;
  // Market context at decision time
  liquidity: number;
  closeTime: string;
  uniqueBettorCount: number;
  description: string;
}

export interface TradeExecution {
  traceId: string;
  timestamp: string;
  marketId: string;
  question: string;
  direction: "YES" | "NO";
  amount: number;
  marketProb: number;
  estimate: number;
  edge: number;
  dryRun: boolean;
  venue: "manifold" | "polymarket";
  polyTokenId?: string;
  shares?: number; // actual shares received (for fill-price calculation)
  action?: "SELL"; // present on sell records written after position is closed
  result?: {
    betId?: string;
    orderId?: string;
    error?: string;
  };
}

export interface PositionSnapshot {
  timestamp: string;
  traceId: string;
  marketId: string;
  question: string;
  direction: "YES" | "NO";
  amount: number;
  estimate: number;
  entryProb: number;
  currentProb: number;
  unrealizedPnl: number;
}

export interface BetResponse {
  betId: string;
  shares: number;
  // Manifold returns more fields; we track shares for fill-price calculation
}

export interface Resolution {
  traceId: string;
  resolvedAt: string;
  marketId: string;
  question: string;
  resolution: "YES" | "NO" | "MKT" | "CANCEL";
  direction: "YES" | "NO";
  estimate: number;
  marketProbAtBet: number;
  edge: number;
  confidence: string;
  amount: number;
  won: boolean;
  pnl: number;
  brierScore: number;
  venue: "manifold" | "polymarket";
}

export interface CalibrationBucket {
  range: string;
  count: number;
  avgEstimate: number;
  actualFrequency: number;
  overconfidence: number;
}

export interface CalibrationReport {
  totalResolved: number;
  winRate: number;
  totalPnl: number;
  roi: number;
  avgBrierScore: number;
  buckets: CalibrationBucket[];
  byConfidence: Record<
    "low" | "medium" | "high",
    { count: number; winRate: number; avgBrier: number; roi: number }
  >;
  recentTrend: { winRate: number; avgBrier: number; roi: number };
}
