import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client, EventLogPoint, AnalyticsWindowData } from "@chirropjs/chirrop";
import { z } from "zod";
import { formatError } from "../errors.js";
import { eventRefFields, resolveEventId, resolveEventRefs } from "../refs.js";
import { computeBucketStats, computeGlobalStats, computeTrend, classifyPctChange, type ChangeSignal } from "../stats.js";

const EVENT_NOT_FOUND_HINT = "Call list_events to see valid event IDs.";

function interpretAnalytics(data: AnalyticsWindowData | null): {
  value_signal: ChangeSignal;
  count_signal: ChangeSignal;
  mean_signal: ChangeSignal;
  volatility_change: string;
  summary: string;
} | null {
  if (!data) return null;

  const valueSignal = classifyPctChange(data.value_pct_change);
  const countSignal = classifyPctChange(data.count_pct_change, 10, 25);
  const meanSignal = classifyPctChange(data.mean_pct_change, 5, 15);

  let volatilityChange = "similar_variance";
  if (data.previous_stddev > 0) {
    const ratio = data.current_stddev / data.previous_stddev;
    if (ratio > 1.5) volatilityChange = "much_higher_variance";
    else if (ratio > 1.1) volatilityChange = "slightly_higher_variance";
    else if (ratio < 0.67) volatilityChange = "much_lower_variance";
    else if (ratio < 0.9) volatilityChange = "slightly_lower_variance";
  }

  const parts: string[] = [];
  if (valueSignal !== "insufficient_data") {
    const pctStr = ` (${data.value_pct_change > 0 ? "+" : ""}${data.value_pct_change.toFixed(1)}%)`;
    parts.push(`Total value ${valueSignal.replace(/_/g, " ")}${pctStr}`);
  }
  if (countSignal !== "insufficient_data") {
    const pctStr = ` (${data.count_pct_change > 0 ? "+" : ""}${data.count_pct_change.toFixed(1)}%)`;
    parts.push(`event count ${countSignal.replace(/_/g, " ")}${pctStr}`);
  }
  if (meanSignal !== "insufficient_data") {
    const pctStr = ` (${data.mean_pct_change > 0 ? "+" : ""}${data.mean_pct_change.toFixed(1)}%)`;
    parts.push(`per-event mean ${meanSignal.replace(/_/g, " ")}${pctStr}`);
  }
  if (volatilityChange !== "similar_variance") {
    parts.push(volatilityChange.replace(/_/g, " "));
  }

  return {
    value_signal: valueSignal,
    count_signal: countSignal,
    mean_signal: meanSignal,
    volatility_change: volatilityChange,
    summary: parts.length > 0 ? parts.join("; ") + "." : "No significant changes detected.",
  };
}

function detectAnomalyBuckets(points: EventLogPoint[], thresholdSigma: number) {
  const bucketMeans = points.map((p) =>
    computeBucketStats(p.count, p.value, p.squares).mean
  );

  const globalStats = computeGlobalStats(bucketMeans);

  const anomalies = points
    .map((p, i) => {
      const bucketStats = computeBucketStats(p.count, p.value, p.squares);
      const deviationSigma =
        globalStats.stddev > 0
          ? Math.abs(bucketStats.mean - globalStats.mean) / globalStats.stddev
          : 0;
      if (deviationSigma <= thresholdSigma) return null;
      return {
        occurred_at: p.occurred_at,
        mean: bucketStats.mean,
        deviation_sigma: deviationSigma,
        direction: bucketStats.mean > globalStats.mean ? ("spike" as const) : ("drop" as const),
        count: p.count,
        value: p.value,
        min: p.min,
        max: p.max,
        bucket_index: i,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return { globalStats, anomalies, bucketCount: points.length };
}

const anomaliesOutputSchema = {
  event_id: z.string(),
  period: z.enum(["minute", "hour", "day"]),
  threshold_sigma: z.number(),
  global_mean: z.number(),
  global_stddev: z.number(),
  bucket_count: z.number(),
  anomaly_count: z.number(),
  has_sufficient_data: z.boolean(),
  anomalies: z.array(
    z.object({
      occurred_at: z.string(),
      mean: z.number(),
      deviation_sigma: z.number(),
      direction: z.enum(["spike", "drop"]),
      count: z.number(),
      value: z.number(),
      min: z.number(),
      max: z.number(),
      bucket_index: z.number(),
    })
  ),
  retrieved_at: z.string(),
};

export function registerAnalyticsTools(server: McpServer, client: Client): void {
  server.registerTool("get_event_analytics", {
    title: "Get Event Analytics",
    description:
      "Get window comparison analytics for an event. Compares current period against a previous period, returning " +
      "value/count totals, deltas, percentage changes, means, and standard deviations. " +
      "An _interpretation block is included with plain-language signals (significant_increase, stable, etc.) and a summary sentence. " +
      "Use analytics periods (1h, 1d, 7d, 1m) here — not rollup periods (minute, hour, day). " +
      "Common comparisons: last hour vs previous hour (1h/previous_window), last hour vs same hour yesterday (1h/previous_1d).",
    inputSchema: {
      ...eventRefFields,
      period: z
        .enum(["1h", "1d", "7d", "1m"])
        .describe("Current window size: 1 hour, 1 day, 7 days, or 1 month."),
      previous: z
        .enum(["previous_window", "previous_1d", "previous_7d", "previous_1m"])
        .describe(
          "Comparison window. 'previous_window' compares against the same-sized window immediately prior. " +
          "'previous_1d' compares same window yesterday, 'previous_7d' last week, 'previous_1m' last month."
        ),
    },
    annotations: {
      title: "Get Event Analytics",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ event_id, event, agent, period, previous }) => {
    try {
      const eventId = await resolveEventId(client, { event_id, event, agent });
      const analytics = await client.getEventAnalytics(eventId, {
        view: "window",
        period,
        previous,
      });
      const enriched = {
        ...analytics,
        _interpretation: interpretAnalytics(analytics.data),
        retrieved_at: new Date().toISOString(),
      };
      return { content: [{ type: "text" as const, text: JSON.stringify(enriched) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get event analytics", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("detect_anomalies", {
    title: "Detect Anomalies",
    description:
      "Scan an event stream's rollup buckets and return the specific time buckets where values deviate more than " +
      "threshold_sigma standard deviations from the global mean. " +
      "Each anomaly includes the bucket time, mean value, deviation in sigmas, and direction (spike or drop). " +
      "Use 'minute' for recent spikes, 'hour' for daily patterns, 'day' for long-term trends. " +
      "has_sufficient_data is false when fewer than 10 buckets are available (stddev unreliable).",
    inputSchema: {
      ...eventRefFields,
      period: z.enum(["minute", "hour", "day"]).optional().describe("Rollup bucket granularity. Defaults to 'hour'."),
      limit: z.number().int().positive().max(500).optional().describe("Number of buckets to analyze. More = more reliable baseline. Defaults to 100."),
      threshold_sigma: z.number().positive().optional().describe("Standard deviations from the mean to flag as anomalous. Defaults to 2.0."),
    },
    outputSchema: anomaliesOutputSchema,
    annotations: {
      title: "Detect Anomalies",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ event_id, event, agent, period = "hour", limit = 100, threshold_sigma = 2.0 }) => {
    try {
      const eventId = await resolveEventId(client, { event_id, event, agent });
      const rollups = await client.getEventLogs(eventId, { period, limit });
      const points = rollups as unknown as EventLogPoint[];
      const { globalStats, anomalies, bucketCount } = detectAnomalyBuckets(points, threshold_sigma);

      const result = {
        event_id: eventId,
        period,
        threshold_sigma,
        global_mean: globalStats.mean,
        global_stddev: globalStats.stddev,
        bucket_count: bucketCount,
        anomaly_count: anomalies.length,
        has_sufficient_data: bucketCount >= 10,
        anomalies,
        retrieved_at: new Date().toISOString(),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("detect anomalies", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("compare_events", {
    title: "Compare Events",
    description:
      "Fetch rollups for multiple events over the same period and return a side-by-side statistical comparison. " +
      "Each stream entry includes mean, stddev, trend_direction, last_value, and anomaly_count (using 2σ threshold). " +
      "Useful for correlating related numeric streams or identifying which stream is behaving differently.",
    inputSchema: {
      event_ids: z
        .array(z.string())
        .min(2)
        .max(10)
        .describe(
          "Events to compare: each entry is an event UUID or an exact event name. " +
          "Names that exist under multiple agents must be passed as UUIDs. Minimum 2, maximum 10."
        ),
      period: z.enum(["minute", "hour", "day"]).optional().describe("Rollup bucket granularity, applied to all streams."),
      limit: z.number().int().positive().optional().describe("Number of recent buckets per stream. Defaults to 100."),
    },
    annotations: {
      title: "Compare Events",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ event_ids, period, limit }) => {
    try {
      const resolvedIds = await resolveEventRefs(client, event_ids);
      const allRollups = await Promise.all(
        resolvedIds.map((id) => client.getEventLogs(id, { period, limit }))
      );

      const streams = (allRollups as unknown as EventLogPoint[][]).map((rollups, i) => {
        const bucketMeans = rollups.map((p) =>
          computeBucketStats(p.count, p.value, p.squares).mean
        );
        const globalStats = computeGlobalStats(bucketMeans);

        const anomalyCount = rollups.filter((p) => {
          const stats = computeBucketStats(p.count, p.value, p.squares);
          return globalStats.stddev > 0
            ? Math.abs(stats.mean - globalStats.mean) / globalStats.stddev > 2.0
            : false;
        }).length;

        const lastPoint = rollups.at(-1);
        const lastMean = bucketMeans.at(-1) ?? 0;
        const prevMean = bucketMeans.at(-2) ?? lastMean;
        const trendDirection = computeTrend(lastMean, prevMean);

        const lastValue = lastPoint
          ? computeBucketStats(lastPoint.count, lastPoint.value, lastPoint.squares).mean
          : 0;

        return {
          event_id: resolvedIds[i],
          mean: globalStats.mean,
          stddev: globalStats.stddev,
          trend_direction: trendDirection,
          last_value: lastValue,
          last_bucket_at: lastPoint?.occurred_at ?? null,
          bucket_count: rollups.length,
          anomaly_count: anomalyCount,
        };
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ period: period ?? "hour", streams, retrieved_at: new Date().toISOString() }),
        }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("compare events", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });
}
