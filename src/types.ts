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
  maxImpactPct: number;
  claudeModel: string;
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
  betAmount: number;
  action: "BET" | "SKIP_LOW_EDGE" | "SKIP_NEGATIVE_KELLY" | "SKIP_ERROR";
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
  result?: {
    betId?: string;
    error?: string;
  };
}

export interface BetResponse {
  betId: string;
  // Manifold returns more fields, but we only need the ID
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
