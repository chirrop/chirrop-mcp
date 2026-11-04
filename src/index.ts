#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createChirrOpClient } from "./client.js";
import { registerLogTools } from "./tools/logs.js";
import { registerEventTools } from "./tools/events.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerPolicyTools } from "./tools/policies.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerDestinationTools } from "./tools/destinations.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

const server = new McpServer(
  {
    name: "chirrop-mcp",
    version,
  },
  {
    instructions: [
      "ChirrOp MCP server for monitoring flat numeric events.",
      "",
      "## Discovery",
      "Start with list_events to see all event definitions. Each event is identified by its agent + event name pair.",
      "",
      "## Event references",
      "Tools that take an event_id (UUID) also accept event (name) plus optional agent instead — the server resolves the UUID for you. If a name exists under multiple agents, pass agent or the UUID.",
      "",
      "## No deletes",
      "The ChirrOp API has no delete operations. To retire a policy or destination, set enabled=false via update_policy / update_destination. Event definitions cannot be removed.",
      "",
      "## Secrets",
      "Destination url and credential values accept 'env:CHIRROP_SECRET_<NAME>' references (only CHIRROP_SECRET_-prefixed variables), resolved from the server's environment — prefer these over pasting secrets into the conversation. Returned URLs and credentials are redacted.",
      "",
      "## Period types (do not mix these up)",
      "- Rollup periods: minute, hour, day — used in get_event_rollups and policy evaluation (create_policy, update_policy).",
      "- Analytics periods: 1h, 1d, 7d, 1m — used only in get_event_analytics for window comparisons.",
      "",
      "## Common workflows",
      "- **Investigate an event**: list_events → get_event → get_event_rollups (recent trend) → get_event_analytics (period comparison).",
      "- **Set up alerting**: create_event (if needed) → create_policy → create_destination → test_destination → get_alert_deliveries (kind='test').",
      "- **Triage an alert**: get_alert → get_event_rollups (same period as policy) → get_event_analytics → acknowledge/resolve/archive.",
      "",
      "## Alert lifecycle",
      "triggered → acknowledged → resolved → archived. Use acknowledge_alert, resolve_alert, archive_alert to advance.",
      "",
      "## Policy aggregates",
      "Match aggregate to the event shape: sum for *.count events, average/p95_est for *.duration_ms, min/max for gauges.",
      "",
      "## Destinations",
      "Always call test_destination after creating a destination, then verify with get_alert_deliveries (kind='test').",
    ].join("\n"),
  }
);

const client = createChirrOpClient();

registerLogTools(server, client);
registerEventTools(server, client);
registerAnalyticsTools(server, client);
registerPolicyTools(server, client);
registerAlertTools(server, client);
registerDestinationTools(server, client);
registerResources(server, client);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
