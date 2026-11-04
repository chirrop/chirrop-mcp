export interface BucketStats {
  mean: number;
  stddev: number;
  variance: number;
}

export type ChangeSignal =
  | "significant_increase"
  | "moderate_increase"
  | "stable"
  | "moderate_decrease"
  | "significant_decrease"
  | "insufficient_data";

export function computeBucketStats(count: number, value: number, squares: number): BucketStats {
  if (count === 0) return { mean: 0, stddev: 0, variance: 0 };
  const mean = value / count;
  const variance = Math.max(0, squares / count - mean * mean);
  return { mean, stddev: Math.sqrt(variance), variance };
}

export function computeGlobalStats(means: number[]): BucketStats {
  if (means.length === 0) return { mean: 0, stddev: 0, variance: 0 };
  const mean = means.reduce((a, b) => a + b, 0) / means.length;
  const variance = means.reduce((s, m) => s + (m - mean) ** 2, 0) / means.length;
  return { mean, stddev: Math.sqrt(variance), variance };
}

export type TrendDirection = "up" | "down" | "stable";

export function computeTrend(current: number, previous: number): TrendDirection {
  if (current > previous * 1.01) return "up";
  if (current < previous * 0.99) return "down";
  return "stable";
}

export function classifyPctChange(
  pct: number | undefined | null,
  moderateThreshold = 10,
  significantThreshold = 25
): ChangeSignal {
  if (pct == null || !isFinite(pct)) return "insufficient_data";
  if (pct > significantThreshold) return "significant_increase";
  if (pct > moderateThreshold) return "moderate_increase";
  if (pct < -significantThreshold) return "significant_decrease";
  if (pct < -moderateThreshold) return "moderate_decrease";
  return "stable";
}
