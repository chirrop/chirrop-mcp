import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@chirropjs/chirrop";
import { z } from "zod";
import { formatError } from "../errors.js";
import { eventRefFields, resolveEventId } from "../refs.js";

const POLICY_NOT_FOUND_HINT = "Call list_policies to see valid policy IDs.";
const EVENT_NOT_FOUND_HINT = "Call list_events to see valid event IDs.";

export function registerPolicyTools(server: McpServer, client: Client): void {
  server.registerTool("list_policies", {
    title: "List Policies",
    description:
      "List monitoring policies (alert rules) in the ChirrOp account, optionally filtered to a single event " +
      "(by event_id, or by event name + agent).",
    inputSchema: { ...eventRefFields },
    annotations: {
      title: "List Policies",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ event_id, event, agent }) => {
    try {
      let filterEventId: string | undefined;
      if (event_id || event) {
        filterEventId = await resolveEventId(client, { event_id, event, agent });
      }
      let policies = await client.listPolicies();
      if (filterEventId) policies = policies.filter((p) => p.event_id === filterEventId);
      return { content: [{ type: "text" as const, text: JSON.stringify(policies) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("list policies", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("get_policy", {
    title: "Get Policy",
    description: "Get a single monitoring policy by its UUID.",
    inputSchema: {
      policy_id: z.string().uuid("Must be a valid UUID.").describe("The policy UUID to retrieve."),
    },
    annotations: {
      title: "Get Policy",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ policy_id }) => {
    try {
      const policy = await client.getPolicy(policy_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(policy, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get policy", error, POLICY_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("create_policy", {
    title: "Create Policy",
    description:
      "Create a new monitoring policy (alert rule) for an event. The event definition must already exist; " +
      "identify it by event_id or by event name (+ agent). " +
      "Match the aggregate to the event stream shape: use 'sum' for *.count events, 'average'/'p95_est' for *.duration_ms, " +
      "'average'/'min'/'max' for *.price_usd or *.score. Use rollup periods (minute, hour, day) — not analytics periods. " +
      "Alerts won't be delivered unless you also create a destination. " +
      "Policies cannot be deleted; to retire one, set enabled=false via update_policy.",
    inputSchema: {
      ...eventRefFields,
      title: z.string().describe("Human-readable policy title, e.g. 'High error rate'."),
      description: z.string().optional().describe("Longer description of what this policy catches."),
      channel: z.string().describe("Policy routing namespace, e.g. 'ops'. Used by destinations with scope='policies' to filter which alerts they receive."),
      period: z.enum(["minute", "hour", "day"]).describe("Evaluation period. The aggregate is computed over each period bucket."),
      aggregate: z
        .enum(["sum", "count", "average", "min", "max", "p95_est", "p99_est"])
        .describe(
          "Aggregate function: 'sum' for counts/usage, 'average'/'p95_est'/'p99_est' for latencies, 'min'/'max' for gauges/prices."
        ),
      condition: z.enum(["gt", "lt", "eq", "gte", "lte"]).describe("Comparison operator: gt (>), lt (<), eq (==), gte (>=), lte (<=)."),
      threshold: z.number().finite().describe("Numeric threshold. Alert triggers when aggregate(values) <condition> threshold."),
      severity: z.enum(["info", "warning", "error", "critical"]).describe("Alert severity. Affects presentation in destinations."),
      enabled: z.boolean().describe("Whether this policy is active."),
    },
    annotations: {
      title: "Create Policy",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  }, async ({ event_id, event, agent, ...params }) => {
    try {
      const eventId = await resolveEventId(client, { event_id, event, agent });
      const policy = await client.createPolicy({ event_id: eventId, ...params });
      return { content: [{ type: "text" as const, text: JSON.stringify(policy, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("create policy", error, EVENT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("update_policy", {
    title: "Update Policy",
    description:
      "Update an existing monitoring policy. Only provided fields are changed. " +
      "There is no delete_policy; set enabled=false to retire a policy.",
    inputSchema: {
      policy_id: z.string().uuid("Must be a valid UUID.").describe("The policy UUID to update."),
      event_id: z.string().uuid("Must be a valid UUID.").optional().describe("Updated event UUID."),
      title: z.string().optional().describe("Updated title."),
      description: z.string().optional().describe("Updated description."),
      channel: z.string().optional().describe("Updated routing namespace."),
      period: z.enum(["minute", "hour", "day"]).optional().describe("Updated evaluation period."),
      aggregate: z.enum(["sum", "count", "average", "min", "max", "p95_est", "p99_est"]).optional().describe("Updated aggregate function."),
      condition: z.enum(["gt", "lt", "eq", "gte", "lte"]).optional().describe("Updated comparison operator."),
      threshold: z.number().finite().optional().describe("Updated threshold."),
      severity: z.enum(["info", "warning", "error", "critical"]).optional().describe("Updated severity."),
      enabled: z.boolean().optional().describe("Updated enabled state. Set false to retire the policy (there is no delete)."),
    },
    annotations: {
      title: "Update Policy",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ policy_id, ...payload }) => {
    try {
      const policy = await client.updatePolicy(policy_id, payload);
      return { content: [{ type: "text" as const, text: JSON.stringify(policy, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("update policy", error, POLICY_NOT_FOUND_HINT) }], isError: true };
    }
  });
}
