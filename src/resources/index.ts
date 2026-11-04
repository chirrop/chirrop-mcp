import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client, Alert, Event } from "@chirropjs/chirrop";

export function registerResources(server: McpServer, client: Client): void {
  // Static resources

  server.resource(
    "events",
    "chirrop://events",
    {
      description:
        "All event definitions in the ChirrOp account. Each event has an ID, name, agent, unit, timezone, and description.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await client.listEvents(), null, 2),
        },
      ],
    })
  );

  server.resource(
    "triggered-alerts",
    "chirrop://alerts/triggered",
    {
      description:
        "Alerts currently in 'triggered' status that have not been acknowledged, resolved, or archived.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await client.listAlerts("triggered"), null, 2),
        },
      ],
    })
  );

  server.resource(
    "destinations",
    "chirrop://destinations",
    {
      description:
        "All configured notification destinations (email, webhook, Slack, Telegram, Discord) and their current status.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await client.listDestinations(), null, 2),
        },
      ],
    })
  );

  server.resource(
    "events-summary",
    "chirrop://events/summary",
    {
      description:
        "Snapshot of all events combined with currently triggered alert counts. " +
        "Shows which event_ids have active alerts without requiring per-event API calls. " +
        "Use as a quick dashboard overview before drilling into individual streams.",
      mimeType: "application/json",
    },
    async (uri) => {
      const [events, triggeredAlerts] = await Promise.all([
        client.listEvents(),
        client.listAlerts("triggered"),
      ]);
      const alertedEventIds = [
        ...new Set(
          (triggeredAlerts as unknown as Alert[]).map((a) => a.event_id).filter(Boolean)
        ),
      ];
      const summary = {
        events,
        triggered_alert_count: triggeredAlerts.length,
        events_with_active_alerts: alertedEventIds,
        snapshot_at: new Date().toISOString(),
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  // Resource templates (parameterized)

  server.resource(
    "event-rollups",
    new ResourceTemplate("chirrop://events/{event_id}/rollups/{period}", {
      list: async () => ({
        resources: (await client.listEvents()).map((e: { event_id: string; event: string }) => ({
          uri: `chirrop://events/${e.event_id}/rollups/hour`,
          name: `${e.event} — hourly rollups`,
          mimeType: "application/json",
        })),
      }),
      complete: {
        period: (value) => ["minute", "hour", "day"].filter((p) => p.startsWith(value)),
        event_id: async (value) =>
          (await client.listEvents())
            .map((e) => e.event_id)
            .filter((id) => id.startsWith(value))
            .slice(0, 25),
      },
    }),
    {
      description:
        "Time-bucketed rollup data for a specific event. Period must be minute, hour, or day.",
      mimeType: "application/json",
    },
    async (uri, { event_id, period }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            await client.getEventLogs(event_id as string, { period: period as "minute" | "hour" | "day" }),
            null,
            2
          ),
        },
      ],
    })
  );

  server.resource(
    "alerts-by-status",
    new ResourceTemplate("chirrop://alerts/{status}", {
      list: async () => ({
        resources: (["triggered", "acknowledged", "resolved", "archived"] as const).map(
          (s) => ({
            uri: `chirrop://alerts/${s}`,
            name: `${s} alerts`,
            mimeType: "application/json",
          })
        ),
      }),
      complete: {
        status: (value) =>
          ["triggered", "acknowledged", "resolved", "archived"].filter((s) =>
            s.startsWith(value)
          ),
      },
    }),
    {
      description:
        "Alerts filtered by lifecycle status: triggered, acknowledged, resolved, or archived.",
      mimeType: "application/json",
    },
    async (uri, { status }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            await client.listAlerts(status as "triggered" | "acknowledged" | "resolved" | "archived"),
            null,
            2
          ),
        },
      ],
    })
  );

  server.resource(
    "event-analytics",
    new ResourceTemplate("chirrop://events/{event_id}/analytics/{period}/{previous}", {
      list: async () => ({
        resources: (await client.listEvents()).map((e: { event_id: string; event: string }) => ({
          uri: `chirrop://events/${e.event_id}/analytics/1h/previous_window`,
          name: `${e.event} — 1h vs previous window analytics`,
          mimeType: "application/json",
        })),
      }),
      complete: {
        period: (value) => ["1h", "1d", "7d", "1m"].filter((p) => p.startsWith(value)),
        previous: (value) =>
          ["previous_window", "previous_1d", "previous_7d", "previous_1m"].filter((p) =>
            p.startsWith(value)
          ),
        event_id: async (value) =>
          (await client.listEvents())
            .map((e) => e.event_id)
            .filter((id) => id.startsWith(value))
            .slice(0, 25),
      },
    }),
    {
      description:
        "Window comparison analytics for a specific event. " +
        "period must be 1h, 1d, 7d, or 1m. previous must be previous_window, previous_1d, previous_7d, or previous_1m.",
      mimeType: "application/json",
    },
    async (uri, { event_id, period, previous }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            await client.getEventAnalytics(event_id as string, {
              view: "window",
              period: period as "1h" | "1d" | "7d" | "1m",
              previous: previous as "previous_window" | "previous_1d" | "previous_7d" | "previous_1m",
            }),
            null,
            2
          ),
        },
      ],
    })
  );

  server.resource(
    "agent-events",
    new ResourceTemplate("chirrop://agents/{agent}/events", {
      list: async () => {
        const events = await client.listEvents() as unknown as Event[];
        const agentNames = [...new Set(events.map((e) => e.agent).filter((a): a is string => Boolean(a)))];
        return {
          resources: agentNames.map((a) => ({
            uri: `chirrop://agents/${encodeURIComponent(a)}/events`,
            name: `${a} — all events`,
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        agent: async (value) => {
          const events = (await client.listEvents()) as unknown as Event[];
          const agentNames = [...new Set(events.map((e) => e.agent).filter((a): a is string => Boolean(a)))];
          return agentNames.filter((a) => a.startsWith(value)).slice(0, 25);
        },
      },
    }),
    {
      description:
        "All event definitions produced by a specific agent, e.g. chirrop://agents/openclaw.main/events. " +
        "Useful for seeing the full telemetry surface of an OpenClaw instance or skill.",
      mimeType: "application/json",
    },
    async (uri, { agent }) => {
      const events = await client.listEvents() as unknown as Event[];
      const agentEvents = events.filter((e) => e.agent === decodeURIComponent(agent as string));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              agent: decodeURIComponent(agent as string),
              event_count: agentEvents.length,
              events: agentEvents,
            }, null, 2),
          },
        ],
      };
    }
  );
}
