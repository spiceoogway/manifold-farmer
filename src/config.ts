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

function envFloatRange(key: string, fallback: number, min: number, max: number): number {
  const n = envFloat(key, fallback);
  if (n < min || n > max) {
    throw new Error(`${key} must be between ${min} and ${max}, got ${n}`);
  }
  return n;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) throw new Error(`Invalid integer for ${key}: ${val}`);
  return n;
}

function envIntMin(key: string, fallback: number, min: number): number {
  const n = envInt(key, fallback);
  if (n < min) {
    throw new Error(`${key} must be >= ${min}, got ${n}`);
  }
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
    edgeThreshold: envFloatRange("EDGE_THRESHOLD", 0.1, 0, 1),
    kellyFraction: envFloatRange("KELLY_FRACTION", 0.25, 0, 1),
    maxPositionPct: envFloatRange("MAX_POSITION_PCT", 0.2, 0, 1),
    maxBetAmount: envIntMin("MAX_BET_AMOUNT", 50, 1),
    minLiquidity: envIntMin("MIN_LIQUIDITY", 100, 0),
    maxMarketsPerRun: envIntMin("MAX_MARKETS_PER_RUN", 20, 1),
    claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  };
}
