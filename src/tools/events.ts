import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client, Event, EventLogPoint, Alert, Policy } from "@chirropjs/chirrop";
import { z } from "zod";
import { formatError } from "../errors.js";
import { eventRefFields, resolveEventId } from "../refs.js";
import { analyzeBuckets, computeBucketStats, computeTrend } from "../stats.js";

const EVENT_NOT_FOUND_HINT = "Call list_events to see valid event IDs.";

function enrichRollups(points: EventLogPoint[], thresholdSigma: number) {
  const { bucketMeans, globalStats, deviationSigma } = analyzeBuckets(points);

  const enrichedPoints = points.map((p, i) => {
    const bucketStats = computeBucketStats(p.count, p.value, p.squares);
    const prevMean = i > 0 ? bucketMeans[i - 1]! : bucketStats.mean;
    const trendDirection = computeTrend(bucketStats.mean, prevMean);
    return {
      ...p,
      _mean: bucketStats.mean,
      _stddev: bucketStats.stddev,
      _is_anomaly: deviationSigma(i) > thresholdSigma,
      _trend_direction: trendDirection,
    };
  });

  const lastMean = bucketMeans.at(-1) ?? 0;
  const prevLastMean = bucketMeans.at(-2) ?? lastMean;
  const overallTrend = computeTrend(lastMean, prevLastMean);

  return {
    points: enrichedPoints,
    _summary: {
      global_mean: globalStats.mean,
      global_stddev: globalStats.stddev,
      anomaly_count: enrichedPoints.filter((p) => p._is_anomaly).length,
      trend_direction: overallTrend,
      threshold_sigma: thresholdSigma,
      bucket_count: points.length,
    },
  };
}

type RollupPeriod = "minute" | "hour" | "day";
const ROLLUP_PERIODS: readonly RollupPeriod[] = ["minute", "hour", "day"];

/** The rollup period a policy is evaluated over; falls back to hour for unknown values. */
function policyPeriod(policy: Policy): RollupPeriod {
  return (ROLLUP_PERIODS as readonly string[]).includes(policy.period)
    ? (policy.period as RollupPeriod)
    : "hour";
}

/**
 * Fetch the latest bucket for each period the given policies evaluate over,
 * reusing an already-fetched hour bucket. Keyed by period.
 */
async function fetchLatestBuckets(
  client: Client,
  eventId: string,
  policies: Policy[],
  hourBucket: EventLogPoint | null
): Promise<Map<RollupPeriod, EventLogPoint | null>> {
  const buckets = new Map<RollupPeriod, EventLogPoint | null>([["hour", hourBucket]]);
  const missing = [...new Set(policies.map(policyPeriod))].filter((p) => !buckets.has(p));
  const fetched = await Promise.all(
    missing.map((period) =>
      client.getEventLogs(eventId, { period, limit: 1 })
    )
  );
  missing.forEach((period, i) => {
    buckets.set(period, (fetched[i] as unknown as EventLogPoint[])[0] ?? null);
  });
  return buckets;
}

/** Map over items with at most `limit` calls in flight, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

// Keeps get_agent_summary under the API rate limit for agents with many events.
const AGENT_SUMMARY_CONCURRENCY = 5;

/** Compare a policy's aggregate over its latest bucket against its threshold. */
function evaluateProximity(policy: Policy, bucket: EventLogPoint | null) {
  let lastBucketValue: number | null = null;
  if (bucket && policy.aggregate !== "p95_est" && policy.aggregate !== "p99_est") {
    if (policy.aggregate === "sum") lastBucketValue = bucket.value;
    else if (policy.aggregate === "count") lastBucketValue = bucket.count;
    else if (policy.aggregate === "average") lastBucketValue = bucket.count > 0 ? bucket.value / bucket.count : 0;
    else if (policy.aggregate === "min") lastBucketValue = bucket.min;
    else if (policy.aggregate === "max") lastBucketValue = bucket.max;
  }

  let proximityPct: number | null = null;
  let approachingThreshold = false;
  if (lastBucketValue !== null && policy.threshold > 0) {
    proximityPct = (lastBucketValue / policy.threshold) * 100;
    if (policy.condition === "gt" || policy.condition === "gte") {
      approachingThreshold = proximityPct >= 80;
    } else if (policy.condition === "lt" || policy.condition === "lte") {
      approachingThreshold = lastBucketValue <= policy.threshold * 1.2;
    }
  }
  return { lastBucketValue, proximityPct, approachingThreshold };
}

const policyProximitySchema = z.object({
  policy_id: z.string(),
  title: z.string(),
  aggregate: z.string(),
  condition: z.string(),
  threshold: z.number(),
  period: z.enum(["minute", "hour", "day"]),
  last_bucket_value: z.number().nullable(),
  proximity_pct: z.number().nullable(),
  approaching_threshold: z.boolean(),
});

const streamHealthOutputSchema = {
  event_id: z.string(),
  status: z.enum(["healthy", "stale", "alert_active", "degraded"]),
  last_data_at: z.string().nullable(),
  minutes_since_last_data: z.number().nullable(),
  is_stale: z.boolean(),
  active_alert_count: z.number(),
  active_alerts: z.array(
    z.object({
      alert_id: z.string(),
      severity: z.string(),
      status: z.string(),
      triggered_at: z.string().nullable(),
    })
  ),
  policy_proximity: z.array(policyProximitySchema),
  retrieved_at: z.string(),
};

const agentSummaryOutputSchema = {
  agent: z.string(),
  event_count: z.number(),
  message: z.string().optional(),
  status_summary: z.record(z.number()).optional(),
  overall_health: z.enum(["healthy", "needs_attention"]).optional(),
  streams: z.array(
    z.object({
      event_id: z.string(),
      event: z.string(),
      title: z.string().nullable(),
      unit: z.string().nullable(),
      status: z.string(),
      last_data_at: z.string().nullable(),
      minutes_since_last_data: z.number().nullable(),
      is_stale: z.boolean(),
      active_alert_count: z.number(),
      approaching_threshold: z.boolean(),
      policy_count: z.number(),
      error: z.string().optional(),
    })
  ),
  retrieved_at: z.string(),
};

export function registerEventTools(server: McpServer, client: Client): void {
  server.registerTool("list_events", {
    title: "List Events",
    description:
      "List event definitions in the ChirrOp account. Returns event_id, name, agent, unit, timezone, and description for each. " +
      "Supports filtering by agent and paginating results to avoid dumping large accounts into context. " +
      "Use list_agents first if you don't know the exact agent string.",
    inputSchema: {
      agent: z.string().optional().describe("Only return events produced by this exact agent identity, e.g. 'openclaw.main'."),
      name_contains: z.string().optional().describe("Only return events whose name contains this substring (case-insensitive)."),
      limit: z.number().int().positive().optional().describe("Maximum number of events to return. Defaults to 50; pass a larger value for more."),
      offset: z.number().int().nonnegative().optional().describe("Number of matching events to skip for pagination. Defaults to 0."),
    },
    annotations: {
      title: "List Events",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ agent, name_contains, limit = 50, offset = 0 }) => {
    try {
      let events = (await client.listEvents()) as unknown as Event[];
      if (agent) events = events.filter((e) => e.agent === agent);
      if (name_contains) {
        const needle = name_contains.toLowerCase();
        events = events.filter((e) => e.event.toLowerCase().includes(needle));
      }
      const total = events.length;
      const page = events.slice(offset, offset + limit);
      const hasMore = offset + page.length < total;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total,
            returned: page.length,
            offset,
            has_more: hasMore,
            next_offset: hasMore ? offset + page.length : null,
            events: page,
          }),
        }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("list events", error) }], isError: true };
    }
  });

  server.registerTool("list_agents", {
    title: "List Agents",
    description:
      "List distinct agent identities that have produced events, with their event counts. " +
      "Use this to discover valid agent strings before calling get_agent_summary or filtering list_events.",
    outputSchema: {
      agent_count: z.number(),
      agents: z.array(z.object({ agent: z.string(), event_count: z.number() })),
    },
    annotations: {
      title: "List Agents",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async () => {
    try {
      const events = (await client.listEvents()) as unknown as Event[];
      const counts = new Map<string, number>();
      for (const e of events) {
        if (!e.agent) continue;
        counts.set(e.agent, (counts.get(e.agent) ?? 0) + 1);
      }
      const agents = [...counts.entries()]
        .map(([agent, event_count]) => ({ agent, event_count }))
        .sort((a, b) => a.agent.localeCompare(b.agent));
      const result = { agent_count: agents.length, agents };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("list agents", error) }], isError: true };
    }
  });

  server.registerTool("get_event", {
    title: "Get Event",
    description: "Get a single event definition by UUID, or by event name (with optional agent).",
    inputSchema: { ...eventRefFields },
    annotations: {
      title: "Get Event",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async (ref) => {
    try {
      const eventId = await resolveEventId(client, ref);
      const event = await client.getEvent(eventId);
      return { content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get event", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("create_event", {
    title: "Create Event",
    description:
      "Create a new event definition explicitly. Events are also auto-created when you send logs with an unknown event name. " +
      "Use this to pre-configure metadata like description, unit, timezone, or public visibility before sending any logs. " +
      "Note: events cannot be deleted through this server (the ChirrOp API has no delete operation).",
    inputSchema: {
      event: z
        .string()
        .min(1, "Event name must not be empty")
        .describe("Event name using domain.subject.measure format, e.g. 'task.duration_ms'."),
      agent: z.string().optional().describe("Producer identity to scope this event to, e.g. 'openclaw.main'."),
      title: z.string().optional().describe("Human-readable title."),
      public: z.boolean().optional().describe("Whether the event dashboard page is publicly accessible."),
      description: z.string().optional().describe("Description of what this event tracks."),
      unit: z.string().optional().describe("Unit of measurement, e.g. 'ms', 'count', 'bytes'."),
      timezone: z.string().optional().describe("IANA timezone for day-level rollup alignment, e.g. 'America/Los_Angeles'. Defaults to UTC."),
    },
    annotations: {
      title: "Create Event",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  }, async (params) => {
    try {
      const event = await client.createEvent(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(event, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("create event", error) }], isError: true };
    }
  });

  server.registerTool("update_event", {
    title: "Update Event",
    description:
      "Update an existing event definition's metadata. Only provided fields are changed. " +
      "Identify the event by event_id, or by name + agent (the agent/event pair identifies the event to update; " +
      "to change the name or agent themselves, pass event_id plus the new values).",
    inputSchema: {
      event_id: z.string().uuid("Must be a valid UUID.").optional().describe("The event UUID to update. Provide this OR the current event name (+ agent)."),
      event: z.string().optional().describe("Current event name identifying the event, or (when event_id is given) the new name to set."),
      agent: z.string().optional().describe("Current agent identifying the event, or (when event_id is given) the new agent to set."),
      title: z.string().optional().describe("Updated human-readable title."),
      public: z.boolean().optional().describe("Updated public visibility."),
      description: z.string().optional().describe("Updated description."),
      unit: z.string().optional().describe("Updated unit of measurement."),
      timezone: z.string().optional().describe("Updated IANA timezone."),
    },
    annotations: {
      title: "Update Event",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  }, async ({ event_id, event, agent, ...payload }) => {
    try {
      let eventId: string;
      let renamePayload: { event?: string; agent?: string } = {};
      if (event_id) {
        // event/agent act as new values when the UUID identifies the event
        eventId = event_id;
        if (event !== undefined) renamePayload.event = event;
        if (agent !== undefined) renamePayload.agent = agent;
      } else {
        eventId = await resolveEventId(client, { event, agent });
      }
      const updated = await client.updateEvent(eventId, { ...payload, ...renamePayload });
      return { content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("update event", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("get_event_rollups", {
    title: "Get Event Rollups",
    description:
      "Get time-bucketed rollup data for an event, enriched with per-bucket statistics and a global summary. " +
      "Each bucket includes _mean, _stddev, _is_anomaly (based on threshold_sigma), and _trend_direction. " +
      "The _summary block provides global_mean, global_stddev, anomaly_count, and overall trend_direction. " +
      "Pass summary_only=true to get just the _summary plus anomalous buckets — much cheaper and usually enough. " +
      "Use 'minute' for recent fine-grained data, 'hour' for daily trends, 'day' for longer history. " +
      "For period-over-period comparisons, use get_event_analytics instead.",
    inputSchema: {
      ...eventRefFields,
      period: z.enum(["minute", "hour", "day"]).optional().describe("Rollup bucket period. Use minute/hour/day (not 1h/1d — those are for analytics)."),
      limit: z.number().int().positive().optional().describe("Maximum number of rollup buckets to return. Defaults to 100."),
      offset: z.number().int().nonnegative().optional().describe("Number of buckets to skip for pagination."),
      threshold_sigma: z.number().positive().optional().describe("Standard deviations from the mean to flag a bucket as anomalous. Defaults to 2.0."),
      summary_only: z.boolean().optional().describe("Return only the _summary block and anomalous buckets, omitting the full point list. Defaults to false."),
    },
    annotations: {
      title: "Get Event Rollups",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ event_id, event, agent, threshold_sigma = 2.0, summary_only = false, ...options }) => {
    try {
      const eventId = await resolveEventId(client, { event_id, event, agent });
      const rollups = await client.getEventLogs(eventId, options);
      const enriched = enrichRollups(rollups as unknown as EventLogPoint[], threshold_sigma);
      const retrieved_at = new Date().toISOString();
      const result = summary_only
        ? {
            event_id: eventId,
            _summary: enriched._summary,
            anomalous_points: enriched.points.filter((p) => p._is_anomaly),
            retrieved_at,
          }
        : { event_id: eventId, ...enriched, retrieved_at };
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get event rollups", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("get_stream_health", {
    title: "Get Stream Health",
    description:
      "Check the health of a numeric event stream in one call. Returns status (healthy/stale/alert_active/degraded), " +
      "recency of last data point, active triggered alerts, and proximity to policy thresholds. " +
      "Use this before detect_anomalies or compare_events to get a quick overall picture.",
    inputSchema: {
      ...eventRefFields,
      stale_after_minutes: z.number().int().positive().optional().describe("Minutes without data before marking the stream as stale. Defaults to 60."),
    },
    outputSchema: streamHealthOutputSchema,
    annotations: {
      title: "Get Stream Health",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ event_id, event, agent, stale_after_minutes = 60 }) => {
    try {
      const eventId = await resolveEventId(client, { event_id, event, agent });
      const [recentLogs, triggeredAlerts, policies] = await Promise.all([
        client.getEventLogs(eventId, { period: "hour", limit: 1 }),
        client.listAlerts("triggered"),
        client.listPolicies(),
      ]);

      const typedLogs = recentLogs as unknown as EventLogPoint[];
      const typedAlerts = triggeredAlerts as unknown as Alert[];
      const typedPolicies = policies as unknown as Policy[];

      const lastLog = typedLogs[0] ?? null;
      const lastDataAt = lastLog?.occurred_at ?? null;
      let minutesSinceLast: number | null = null;
      let isStale = true;

      if (lastDataAt) {
        minutesSinceLast = (Date.now() - new Date(lastDataAt).getTime()) / 60000;
        isStale = minutesSinceLast > stale_after_minutes;
      }

      const eventAlerts = typedAlerts.filter((a) => a.event_id === eventId);
      const eventPolicies = typedPolicies.filter((p) => p.event_id === eventId);

      const latestBuckets = await fetchLatestBuckets(client, eventId, eventPolicies, lastLog);
      const policyProximity = eventPolicies.map((policy) => {
        const period = policyPeriod(policy);
        const { lastBucketValue, proximityPct, approachingThreshold } =
          evaluateProximity(policy, latestBuckets.get(period) ?? null);
        return {
          policy_id: policy.policy_id,
          title: policy.title,
          aggregate: policy.aggregate,
          condition: policy.condition,
          threshold: policy.threshold,
          period,
          last_bucket_value: lastBucketValue,
          proximity_pct: proximityPct,
          approaching_threshold: approachingThreshold,
        };
      });

      const activeAlertCount = eventAlerts.length;
      let status: "healthy" | "stale" | "alert_active" | "degraded";
      if (isStale && activeAlertCount > 0) status = "degraded";
      else if (activeAlertCount > 0) status = "alert_active";
      else if (isStale) status = "stale";
      else status = "healthy";

      const result = {
        event_id: eventId,
        status,
        last_data_at: lastDataAt,
        minutes_since_last_data: minutesSinceLast !== null ? Math.round(minutesSinceLast) : null,
        is_stale: isStale,
        active_alert_count: activeAlertCount,
        active_alerts: eventAlerts.map((a) => ({
          alert_id: a.alert_id,
          severity: a.severity,
          status: a.status,
          triggered_at: a.triggered_at ?? null,
        })),
        policy_proximity: policyProximity,
        retrieved_at: new Date().toISOString(),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get stream health", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("get_agent_summary", {
    title: "Get Agent Summary",
    description:
      "Get a health overview of all event streams produced by a specific agent (e.g. an OpenClaw instance or skill). " +
      "Returns each event's current status (healthy/warning/stale/alert_active/degraded, or error if its data couldn't be fetched), recency, active alert count, and whether it is approaching any policy threshold. " +
      "Useful as a single call to answer 'how is my openclaw.main agent performing right now?'",
    inputSchema: {
      agent: z.string().describe("The agent identity to filter by, e.g. 'openclaw.main' or 'openclaw.scheduler'."),
      stale_after_minutes: z.number().int().positive().optional().describe("Minutes without data before marking a stream as stale. Defaults to 60."),
    },
    outputSchema: agentSummaryOutputSchema,
    annotations: {
      title: "Get Agent Summary",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ agent, stale_after_minutes = 60 }) => {
    try {
      const [allEvents, triggeredAlerts, policies] = await Promise.all([
        client.listEvents(),
        client.listAlerts("triggered"),
        client.listPolicies(),
      ]);

      const typedAlerts = triggeredAlerts as unknown as Alert[];
      const typedPolicies = policies as unknown as Policy[];
      const agentEvents = (allEvents as unknown as Event[]).filter(
        (e) => e.agent === agent
      );

      if (agentEvents.length === 0) {
        const result = {
          agent,
          event_count: 0,
          message: `No events found for agent "${agent}". Use list_agents to see available agents.`,
          streams: [],
          retrieved_at: new Date().toISOString(),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      }

      // Fetch the most recent hour bucket for each event, plus the latest
      // bucket for any other period its policies evaluate over. A failed fetch
      // is reported on that stream rather than misread as missing data.
      const latestBuckets = await mapWithConcurrency(
        agentEvents,
        AGENT_SUMMARY_CONCURRENCY,
        async (e) => {
          try {
            const hourLogs = await client.getEventLogs(e.event_id, { period: "hour", limit: 1 });
            const hourBucket = (hourLogs as unknown as EventLogPoint[])[0] ?? null;
            const policies = typedPolicies.filter((p) => p.event_id === e.event_id);
            return { buckets: await fetchLatestBuckets(client, e.event_id, policies, hourBucket) };
          } catch (error) {
            return { buckets: undefined, error };
          }
        }
      );

      // If nothing could be fetched it's an account-level problem (auth, rate
      // limit, outage) — report it as a tool error, not as N stale streams.
      const failure = latestBuckets.find((r) => "error" in r);
      if (failure && latestBuckets.every((r) => "error" in r)) throw failure.error;

      const streams = agentEvents.map((event, i) => {
        const fetched = latestBuckets[i]!;
        const fetchError =
          "error" in fetched ? formatError("fetch rollups", fetched.error, EVENT_NOT_FOUND_HINT) : null;
        const buckets = fetched.buckets ?? new Map<RollupPeriod, EventLogPoint | null>();
        const lastLog = buckets.get("hour") ?? null;
        const lastDataAt = lastLog?.occurred_at ?? null;
        let minutesSinceLast: number | null = null;
        let isStale = true;

        if (lastDataAt) {
          minutesSinceLast = (Date.now() - new Date(lastDataAt).getTime()) / 60000;
          isStale = minutesSinceLast > stale_after_minutes;
        }

        const eventAlerts = typedAlerts.filter((a) => a.event_id === event.event_id);
        const eventPolicies = typedPolicies.filter((p) => p.event_id === event.event_id);

        const approachingThreshold = eventPolicies.some(
          (policy) =>
            evaluateProximity(policy, buckets.get(policyPeriod(policy)) ?? null).approachingThreshold
        );

        let status: string;
        if (fetchError) status = "error";
        else if (isStale && eventAlerts.length > 0) status = "degraded";
        else if (eventAlerts.length > 0) status = "alert_active";
        else if (isStale) status = "stale";
        else if (approachingThreshold) status = "warning";
        else status = "healthy";

        return {
          event_id: event.event_id,
          event: event.event,
          title: event.title ?? null,
          unit: event.unit ?? null,
          status,
          last_data_at: lastDataAt,
          minutes_since_last_data: minutesSinceLast !== null ? Math.round(minutesSinceLast) : null,
          is_stale: isStale,
          active_alert_count: eventAlerts.length,
          approaching_threshold: approachingThreshold,
          policy_count: eventPolicies.length,
          ...(fetchError ? { error: fetchError } : {}),
        };
      });

      const statusCounts = streams.reduce<Record<string, number>>((acc, s) => {
        acc[s.status] = (acc[s.status] ?? 0) + 1;
        return acc;
      }, {});

      const result = {
        agent,
        event_count: agentEvents.length,
        status_summary: statusCounts,
        overall_health: streams.every((s) => s.status === "healthy")
          ? ("healthy" as const)
          : ("needs_attention" as const),
        streams,
        retrieved_at: new Date().toISOString(),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get agent summary", error) }], isError: true };
    }
  });
}
