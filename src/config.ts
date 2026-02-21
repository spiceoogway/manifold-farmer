import "dotenv/config";
import type { Config } from "./types.js";

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function envFloat(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseFloat(val);
  if (isNaN(n)) throw new Error(`Invalid number for ${key}: ${val}`);
  return n;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`Invalid integer for ${key}: ${val}`);
  return n;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key]?.toLowerCase();
  if (!val) return fallback;
  return val === "true" || val === "1";
}

export function loadConfig(): Config {
  return {
    manifoldApiKey: requireEnv("MANIFOLD_API_KEY"),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    dryRun: envBool("DRY_RUN", true),
    edgeThreshold: envFloat("EDGE_THRESHOLD", 0.1),
    kellyFraction: envFloat("KELLY_FRACTION", 0.25),
    maxPositionPct: envFloat("MAX_POSITION_PCT", 0.2),
    maxBetAmount: envInt("MAX_BET_AMOUNT", 50),
    minLiquidity: envInt("MIN_LIQUIDITY", 100),
    maxMarketsPerRun: envInt("MAX_MARKETS_PER_RUN", 20),
    claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  };
}
