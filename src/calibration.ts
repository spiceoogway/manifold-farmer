import type { Resolution, CalibrationReport, CalibrationBucket } from "./types.js";

export function computeCalibration(resolutions: Resolution[]): CalibrationReport {
  // Exclude CANCEL from metrics
  const valid = resolutions.filter((r) => r.resolution !== "CANCEL");

  const totalResolved = valid.length;
  const wins = valid.filter((r) => r.won).length;
  const winRate = totalResolved > 0 ? wins / totalResolved : 0;
  const totalPnl = valid.reduce((sum, r) => sum + r.pnl, 0);
  const totalWagered = valid.reduce((sum, r) => sum + r.amount, 0);
  const roi = totalWagered > 0 ? totalPnl / totalWagered : 0;
  const avgBrierScore =
    totalResolved > 0
      ? valid.reduce((sum, r) => sum + r.brierScore, 0) / totalResolved
      : 0;

  const buckets = computeBuckets(valid);
  const byConfidence = computeByConfidence(valid);
  const recentTrend = computeRecentTrend(valid);

  return {
    totalResolved,
    winRate,
    totalPnl,
    roi,
    avgBrierScore,
    buckets,
    byConfidence,
    recentTrend,
  };
}

function computeBuckets(resolutions: Resolution[]): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];

  for (let low = 0; low < 100; low += 10) {
    const high = low + 10;
    const range = `${low}-${high}%`;

    // Bucket by the estimate transformed to "probability of the outcome we bet on"
    // For YES bets, this is the estimate directly
    // For NO bets, this is 1 - estimate (our confidence the answer is NO)
    const inBucket = resolutions.filter((r) => {
      const p = r.direction === "YES" ? r.estimate : 1 - r.estimate;
      const pPct = p * 100;
      return pPct >= low && pPct < high;
    });

    if (inBucket.length === 0) continue;

    const avgEstimate =
      inBucket.reduce((sum, r) => {
        return sum + (r.direction === "YES" ? r.estimate : 1 - r.estimate);
      }, 0) / inBucket.length;

    const actualFrequency =
      inBucket.filter((r) => r.won).length / inBucket.length;

    buckets.push({
      range,
      count: inBucket.length,
      avgEstimate,
      actualFrequency,
      overconfidence: avgEstimate - actualFrequency,
    });
  }

  return buckets;
}

function computeByConfidence(
  resolutions: Resolution[]
): CalibrationReport["byConfidence"] {
  const levels = ["low", "medium", "high"] as const;
  const result = {} as CalibrationReport["byConfidence"];

  for (const level of levels) {
    const group = resolutions.filter((r) => r.confidence === level);
    const count = group.length;
    const wins = group.filter((r) => r.won).length;
    const winRate = count > 0 ? wins / count : 0;
    const avgBrier =
      count > 0
        ? group.reduce((sum, r) => sum + r.brierScore, 0) / count
        : 0;
    const wagered = group.reduce((sum, r) => sum + r.amount, 0);
    const pnl = group.reduce((sum, r) => sum + r.pnl, 0);
    const roi = wagered > 0 ? pnl / wagered : 0;

    result[level] = { count, winRate, avgBrier, roi };
  }

  return result;
}

function computeRecentTrend(
  resolutions: Resolution[]
): CalibrationReport["recentTrend"] {
  const recent = resolutions.slice(-20);
  const count = recent.length;

  if (count === 0) {
    return { winRate: 0, avgBrier: 0, roi: 0 };
  }

  const wins = recent.filter((r) => r.won).length;
  const winRate = wins / count;
  const avgBrier =
    recent.reduce((sum, r) => sum + r.brierScore, 0) / count;
  const wagered = recent.reduce((sum, r) => sum + r.amount, 0);
  const pnl = recent.reduce((sum, r) => sum + r.pnl, 0);
  const roi = wagered > 0 ? pnl / wagered : 0;

  return { winRate, avgBrier, roi };
}
