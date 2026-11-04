import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@chirropjs/chirrop";
import { z } from "zod";
import { formatError } from "../errors.js";
import { eventRefFields, resolveEventId } from "../refs.js";

const ALERT_NOT_FOUND_HINT = "Call list_alerts to see valid alert IDs.";

export function registerAlertTools(server: McpServer, client: Client): void {
  server.registerTool("list_alerts", {
    title: "List Alerts",
    description:
      "List alerts, optionally filtered by status and event (by event_id, or by event name + agent). " +
      "Lifecycle: triggered → acknowledged → resolved → archived. " +
      "Use status='triggered' to see active alerts needing attention. " +
      "Results are paginated to avoid dumping large alert histories into context.",
    inputSchema: {
      status: z
        .enum(["triggered", "acknowledged", "resolved", "archived"])
        .optional()
        .describe("Filter by alert lifecycle status. Omit to list all alerts."),
      ...eventRefFields,
      limit: z.number().int().positive().optional().describe("Maximum number of alerts to return. Defaults to 50; pass a larger value for more."),
      offset: z.number().int().nonnegative().optional().describe("Number of matching alerts to skip for pagination. Defaults to 0."),
    },
    annotations: {
      title: "List Alerts",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ status, event_id, event, agent, limit = 50, offset = 0 }) => {
    try {
      let filterEventId: string | undefined;
      if (event_id || event) {
        filterEventId = await resolveEventId(client, { event_id, event, agent });
      }
      let alerts = await client.listAlerts(status);
      if (filterEventId) alerts = alerts.filter((a) => a.event_id === filterEventId);
      const total = alerts.length;
      const page = alerts.slice(offset, offset + limit);
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
            alerts: page,
          }),
        }],
      };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("list alerts", error) }], isError: true };
    }
  });

  server.registerTool("get_alert", {
    title: "Get Alert",
    description:
      "Get full details of a single alert, including the policy rule that triggered it, " +
      "the actual aggregated values (value, count, min, max), and lifecycle timestamps.",
    inputSchema: {
      alert_id: z.string().uuid("Must be a valid UUID.").describe("The alert UUID."),
    },
    annotations: {
      title: "Get Alert",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ alert_id }) => {
    try {
      const alert = await client.getAlert(alert_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(alert, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get alert", error, ALERT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("get_alert_deliveries", {
    title: "Get Alert Deliveries",
    description:
      "Get delivery attempts for an alert. Shows whether notifications reached destinations (Slack, email, etc.). " +
      "Use kind='alert' for real alert deliveries, kind='test' after calling test_destination, kind='all' only for debugging. " +
      "Pass destination_id to check a specific destination's delivery health (e.g. after test_destination).",
    inputSchema: {
      alert_id: z.string().uuid("Must be a valid UUID.").describe("The alert UUID."),
      kind: z
        .enum(["alert", "test", "all"])
        .optional()
        .describe("Filter by delivery kind. Defaults to showing real alert deliveries."),
      destination_id: z.string().uuid("Must be a valid UUID.").optional().describe("Only return delivery attempts to this destination."),
      limit: z.number().int().positive().optional().describe("Max delivery attempts to return."),
      offset: z.number().int().nonnegative().optional().describe("Pagination offset."),
    },
    annotations: {
      title: "Get Alert Deliveries",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ alert_id, destination_id, ...options }) => {
    try {
      let deliveries = await client.getAlertDeliveries(alert_id, options);
      if (destination_id) {
        deliveries = deliveries.filter((d) => d.destination_id === destination_id);
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(deliveries) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get alert deliveries", error, ALERT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("acknowledge_alert", {
    title: "Acknowledge Alert",
    description:
      "Acknowledge a triggered alert, moving it to 'acknowledged' status. " +
      "This indicates someone is investigating. Check rollups and analytics before acknowledging.",
    inputSchema: {
      alert_id: z.string().uuid("Must be a valid UUID.").describe("The alert UUID to acknowledge."),
    },
    annotations: {
      title: "Acknowledge Alert",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ alert_id }) => {
    try {
      const alert = await client.acknowledgeAlert(alert_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(alert, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("acknowledge alert", error, ALERT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("resolve_alert", {
    title: "Resolve Alert",
    description:
      "Resolve an alert, moving it to 'resolved' status. " +
      "Use when the underlying issue has subsided or been fixed.",
    inputSchema: {
      alert_id: z.string().uuid("Must be a valid UUID.").describe("The alert UUID to resolve."),
    },
    annotations: {
      title: "Resolve Alert",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ alert_id }) => {
    try {
      const alert = await client.resolveAlert(alert_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(alert, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("resolve alert", error, ALERT_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("archive_alert", {
    title: "Archive Alert",
    description:
      "Archive an alert, removing it from active views. " +
      "Use for false positives, expected behavior, or alerts you no longer need to track.",
    inputSchema: {
      alert_id: z.string().uuid("Must be a valid UUID.").describe("The alert UUID to archive."),
    },
    annotations: {
      title: "Archive Alert",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  }, async ({ alert_id }) => {
    try {
      const alert = await client.archiveAlert(alert_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(alert, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("archive alert", error, ALERT_NOT_FOUND_HINT) }], isError: true };
    }
  });
}
