# @chirropjs/chirrop-mcp

MCP server for the [ChirrOp](https://www.chirrop.com) monitoring platform. Exposes the full ChirrOp API as tools, resources, and prompts for any MCP-compatible client (Claude Code, Claude Desktop, Cursor, etc.).

## Install

```bash
npm install @chirropjs/chirrop-mcp
```

Or run directly:

```bash
npx @chirropjs/chirrop-mcp
```

## Configuration

Set your ChirrOp API key as an environment variable:

```bash
export CHIRROP_API_KEY=chp_your_api_key
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chirrop": {
      "command": "npx",
      "args": ["-y", "@chirropjs/chirrop-mcp"],
      "env": {
        "CHIRROP_API_KEY": "chp_your_api_key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add chirrop -- npx -y @chirropjs/chirrop-mcp
```

Make sure `CHIRROP_API_KEY` is set in your shell environment. If the key is missing, the server still starts and every tool call returns an actionable error explaining how to set it.

## Usability notes

- **Event references**: every tool that takes an `event_id` (UUID) also accepts `event` (the event name) plus an optional `agent` — the server resolves the UUID for you. `compare_events` accepts a mix of UUIDs and exact names.
- **Pagination**: `list_events` and `list_alerts` default to 50 results and return `has_more` / `next_offset` for paging.
- **Cheap reads**: `get_event_rollups` supports `summary_only=true` to return just the statistical summary plus anomalous buckets.
- **Timestamps**: time-series and health responses include `retrieved_at` so staleness can be reasoned about reliably.
- **Secrets**: destination `url` and `credentials` values accept `env:VAR_NAME` references, resolved from the server's environment, so secrets never enter the conversation.
- **No deletes**: the ChirrOp API has no delete operations. Retire policies and destinations by setting `enabled: false`; event definitions cannot be removed.

## Tools (27)

### Logs

| Tool | Description |
|------|-------------|
| `send_logs` | Send one or more log entries to ChirrOp, with per-entry structured results |

### Events

| Tool | Description |
|------|-------------|
| `list_events` | List event definitions, filterable by agent/name, with pagination |
| `list_agents` | List distinct agent identities and their event counts |
| `get_event` | Get a single event definition |
| `create_event` | Create a new event definition |
| `update_event` | Update event metadata |
| `get_event_rollups` | Get time-bucketed rollup data (minute/hour/day) with anomaly/trend enrichment; `summary_only` for a cheap overview |
| `get_stream_health` | One-call health check: staleness, active alerts, policy proximity |
| `get_agent_summary` | Health overview of every event stream produced by an agent |

### Analytics

| Tool | Description |
|------|-------------|
| `get_event_analytics` | Get window comparison analytics (1h/1d/7d/1m vs previous) |
| `detect_anomalies` | Scan rollup buckets and return statistically anomalous ones |
| `compare_events` | Side-by-side statistical comparison of multiple event streams |

### Policies

| Tool | Description |
|------|-------------|
| `list_policies` | List monitoring policies, optionally filtered by event |
| `get_policy` | Get a single policy |
| `create_policy` | Create a new alerting policy |
| `update_policy` | Update an existing policy |

### Alerts

| Tool | Description |
|------|-------------|
| `list_alerts` | List alerts, filterable by status/event, with pagination |
| `get_alert` | Get alert details |
| `get_alert_deliveries` | Get delivery attempts for an alert, filterable by kind and destination |
| `acknowledge_alert` | Acknowledge a triggered alert |
| `resolve_alert` | Resolve an alert |
| `archive_alert` | Archive an alert |

### Destinations

| Tool | Description |
|------|-------------|
| `list_destinations` | List notification destinations, filterable by channel/enabled state |
| `get_destination` | Get a single destination |
| `create_destination` | Create a notification destination (email/webhook/Slack/Telegram/Discord); secrets may be `env:VAR` references |
| `update_destination` | Update a destination |
| `test_destination` | Send a test notification and get a test alert_id |

## Resources (8)

| URI | Description |
|-----|-------------|
| `chirrop://events` | All event definitions |
| `chirrop://events/summary` | Events combined with triggered alert counts |
| `chirrop://alerts/triggered` | Currently triggered alerts |
| `chirrop://alerts/{status}` | Alerts filtered by lifecycle status |
| `chirrop://destinations` | All configured destinations |
| `chirrop://events/{event_id}/rollups/{period}` | Time-bucketed rollup data for an event |
| `chirrop://events/{event_id}/analytics/{period}/{previous}` | Window comparison analytics for an event |
| `chirrop://agents/{agent}/events` | All events produced by a specific agent |

## Prompts (5)

| Prompt | Description |
|--------|-------------|
| `setup-monitoring` | Guided walkthrough: create event, policy, destination, and verify |
| `triage-alert` | Investigate an alert through a structured triage loop |
| `compare-analytics` | Walk through a window comparison with interpretation |
| `investigate-stream` | End-to-end health check, anomaly scan, trend context, and recommendation |
| `bulk-ingest-review` | Review ingest health across all streams and produce a markdown summary |

## Development

```bash
git clone https://github.com/chirrop/chirrop-mcp
cd chirrop-mcp
npm install
npm run build
```

Test with the MCP Inspector:

```bash
CHIRROP_API_KEY=chp_your_key npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
