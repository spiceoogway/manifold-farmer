import type { CalibrationReport } from "./types.js";

const MIN_RESOLUTIONS = 10;
const MIN_BUCKET_COUNT = 3;

export function formatFeedback(report: CalibrationReport): string | null {
  if (report.totalResolved < MIN_RESOLUTIONS) return null;

  const lines: string[] = [];

  // Header
  const roiSign = report.roi >= 0 ? "+" : "";
  lines.push(`## Your Past Performance (${report.totalResolved} resolved forecasts)`);
  lines.push(
    `- Win rate: ${pct(report.winRate)} | Brier: ${report.avgBrierScore.toFixed(2)} | ROI: ${roiSign}${pct(report.roi)}`
  );

  // Calibration issues
  const miscalibrated = report.buckets.filter(
    (b) => b.count >= MIN_BUCKET_COUNT && Math.abs(b.overconfidence) >= 0.05
  );

  if (miscalibrated.length > 0) {
    lines.push("");
    lines.push("### Calibration Issues");
    for (const b of miscalibrated) {
      const dir =
        b.overconfidence > 0 ? "OVERCONFIDENT" : "UNDERCONFIDENT";
      const adj = b.overconfidence > 0 ? "Adjust down" : "Adjust up";
      const pts = Math.abs(b.overconfidence * 100).toFixed(0);
      lines.push(
        `- ${b.range} bucket: actual frequency ${pct(b.actualFrequency)}. You are ~${pts}pts ${dir}. ${adj}.`
      );
    }
  }

  const wellCalibrated = report.buckets.filter(
    (b) => b.count >= MIN_BUCKET_COUNT && Math.abs(b.overconfidence) < 0.05
  );
  if (wellCalibrated.length > 0) {
    for (const b of wellCalibrated) {
      lines.push(`- ${b.range} bucket: Well calibrated.`);
    }
  }

  // By confidence
  const conf = report.byConfidence;
  const hasConfData = conf.low.count > 0 || conf.medium.count > 0 || conf.high.count > 0;
  if (hasConfData) {
    lines.push("");
    lines.push("### Confidence Labels");
    for (const level of ["high", "medium", "low"] as const) {
      const c = conf[level];
      if (c.count < 3) continue;
      const quality =
        c.winRate >= 0.65
          ? "Good signal — trust these."
          : c.winRate < 0.5
            ? "Consider abstaining."
            : "Moderate signal.";
      lines.push(
        `- "${level}" → ${pct(c.winRate)} win, ${c.avgBrier.toFixed(2)} Brier. ${quality}`
      );
    }
  }

  // Recent trend
  if (report.totalResolved >= 20) {
    const t = report.recentTrend;
    const trending =
      t.winRate < report.winRate - 0.05
        ? "(declining). Be more selective."
        : t.winRate > report.winRate + 0.05
          ? "(improving). Keep it up."
          : "(stable).";
    lines.push("");
    lines.push(
      `### Recent Trend (last 20): Win rate ${pct(t.winRate)} ${trending}`
    );
  }

  return lines.join("\n");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
