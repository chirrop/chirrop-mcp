import { describe, it, expect } from "vitest";
import { analyzeBuckets, computeBucketStats, computeGlobalStats, computeTrend, classifyPctChange } from "../src/stats.js";

describe("computeBucketStats", () => {
  it("returns zeros for zero count", () => {
    const result = computeBucketStats(0, 0, 0);
    expect(result).toEqual({ mean: 0, stddev: 0, variance: 0 });
  });

  it("computes mean correctly", () => {
    const result = computeBucketStats(4, 20, 0);
    expect(result.mean).toBe(5);
  });

  it("computes stddev from sum of squares", () => {
    // values: [3, 5] → count=2, value=8, squares=34, mean=4, variance=(34/2)-16=1, stddev=1
    const result = computeBucketStats(2, 8, 34);
    expect(result.mean).toBe(4);
    expect(result.variance).toBe(1);
    expect(result.stddev).toBeCloseTo(1);
  });

  it("clamps variance to zero to avoid floating point negatives", () => {
    // squares slightly less than value^2/count due to float error
    const result = computeBucketStats(1, 5, 24.9999999);
    expect(result.variance).toBeGreaterThanOrEqual(0);
    expect(result.stddev).toBeGreaterThanOrEqual(0);
  });
});

describe("computeGlobalStats", () => {
  it("returns zeros for empty array", () => {
    expect(computeGlobalStats([])).toEqual({ mean: 0, stddev: 0, variance: 0 });
  });

  it("returns correct mean for uniform values", () => {
    const result = computeGlobalStats([5, 5, 5, 5]);
    expect(result.mean).toBe(5);
    expect(result.stddev).toBe(0);
  });

  it("computes correct mean and stddev for known values", () => {
    // means: [2, 4, 6] → mean=4, variance=(4+0+4)/3≈2.667, stddev≈1.633
    const result = computeGlobalStats([2, 4, 6]);
    expect(result.mean).toBeCloseTo(4);
    expect(result.stddev).toBeCloseTo(1.633, 2);
  });
});

describe("computeTrend", () => {
  it("returns up when current exceeds previous by more than 1%", () => {
    expect(computeTrend(102, 100)).toBe("up");
  });

  it("returns down when current is more than 1% below previous", () => {
    expect(computeTrend(98, 100)).toBe("down");
  });

  it("returns stable within the 1% band", () => {
    expect(computeTrend(100.5, 100)).toBe("stable");
    expect(computeTrend(99.5, 100)).toBe("stable");
  });
});

describe("classifyPctChange", () => {
  it("returns insufficient_data for null", () => {
    expect(classifyPctChange(null)).toBe("insufficient_data");
  });

  it("returns insufficient_data for undefined", () => {
    expect(classifyPctChange(undefined)).toBe("insufficient_data");
  });

  it("returns insufficient_data for Infinity", () => {
    expect(classifyPctChange(Infinity)).toBe("insufficient_data");
  });

  it("classifies large positive as significant_increase", () => {
    expect(classifyPctChange(30)).toBe("significant_increase");
  });

  it("classifies moderate positive as moderate_increase", () => {
    expect(classifyPctChange(15)).toBe("moderate_increase");
  });

  it("classifies small change as stable", () => {
    expect(classifyPctChange(5)).toBe("stable");
    expect(classifyPctChange(-5)).toBe("stable");
  });

  it("classifies moderate negative as moderate_decrease", () => {
    expect(classifyPctChange(-15)).toBe("moderate_decrease");
  });

  it("classifies large negative as significant_decrease", () => {
    expect(classifyPctChange(-30)).toBe("significant_decrease");
  });

  it("respects custom thresholds", () => {
    expect(classifyPctChange(5, 3, 10)).toBe("moderate_increase");
    expect(classifyPctChange(12, 3, 10)).toBe("significant_increase");
  });
});

describe("analyzeBuckets", () => {
  // 20 steady buckets with mean ~10, a run of empty buckets, and one real spike
  const steady = Array.from({ length: 20 }, (_, i) => ({ count: 10, value: 100 + (i % 3), squares: 1000 }));
  const empty = Array.from({ length: 5 }, () => ({ count: 0, value: 0, squares: 0 }));
  const spike = { count: 10, value: 400, squares: 16000 };

  it("excludes empty buckets from the baseline", () => {
    const { globalStats } = analyzeBuckets([...steady, ...empty]);
    expect(globalStats.mean).toBeCloseTo(10.1, 1);
  });

  it("never flags an empty bucket as an anomaly, but still flags a real spike", () => {
    const points = [...steady, ...empty, spike];
    const { deviationSigma } = analyzeBuckets(points);
    for (let i = 20; i < 25; i++) expect(deviationSigma(i)).toBe(0);
    expect(deviationSigma(25)).toBeGreaterThan(2);
  });
});
