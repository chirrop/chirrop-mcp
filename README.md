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

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `CHIRROP_API_KEY` | Yes | Your ChirrOp API key, used by the server to call the ChirrOp API. Must start with `chp_`. |
| `CHIRROP_SECRET_<NAME>` | No | Secrets for notification destinations (webhook URLs, bot tokens) that you want to reference as `env:CHIRROP_SECRET_<NAME>` instead of pasting them into the conversation. See [Destination secrets](#destination-secrets). |

These are two separate kinds of variable on purpose. `CHIRROP_API_KEY` is the server's own credential and can **never** be referenced from a tool call. Only `CHIRROP_SECRET_`-prefixed variables can, so a prompt-injected request can't send your API key to an attacker's webhook.

Set the variables wherever your MCP client launches the server. The server does not read `.env` files itself.

### Claude Code

Pass the key when adding the server:

```bash
claude mcp add chirrop -e CHIRROP_API_KEY=chp_your_api_key -- npx -y @chirropjs/chirrop-mcp
```

To keep the key out of a committed `.mcp.json`, export it in your shell instead and reference it from the config:

```bash
export CHIRROP_API_KEY=chp_your_api_key
```

```json
{
  "mcpServers": {
    "chirrop": {
      "command": "npx",
      "args": ["-y", "@chirropjs/chirrop-mcp"],
      "env": {
        "CHIRROP_API_KEY": "${CHIRROP_API_KEY}"
      }
    }
  }
}
```

Claude Code expands `${CHIRROP_API_KEY}` from the environment it was started in, so export the variable **before** running `claude`, then check the connection with `/mcp`.

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

### Destination secrets

Slack, Discord and webhook URLs and Telegram bot tokens are secrets. Rather than pasting them into the conversation, add them to the server's environment with a `CHIRROP_SECRET_` prefix:

```json
"env": {
  "CHIRROP_API_KEY": "chp_your_api_key",
  "CHIRROP_SECRET_SLACK_URL": "https://hooks.slack.com/services/T000/B000/XXXX",
  "CHIRROP_SECRET_TELEGRAM_TOKEN": "123456:ABC-your-bot-token"
}
```

Then refer to them by name when creating or updating a destination, e.g. *"create a Slack destination using `env:CHIRROP_SECRET_SLACK_URL`"*. The tool call then contains:

```json
{ "channel": "slack", "url": "env:CHIRROP_SECRET_SLACK_URL", "scope": "all", "policy_ids": [], "enabled": true }
```

- References to any variable without the `CHIRROP_SECRET_` prefix (including `CHIRROP_API_KEY`) are refused.
- Restart the server after adding a variable; a reference to an unset variable returns an error.
- Destination URLs and credentials are **redacted** in everything the server returns (tools and the `chirrop://destinations` resource), e.g. `https://hooks.slack.com/[redacted]`. Email `address` and Telegram `chat_id` stay visible because they identify the recipient rather than authenticate.

## Usability notes

- **Event references**: every tool that takes an `event_id` (UUID) also accepts `event` (the event name) plus an optional `agent` — the server resolves the UUID for you. `compare_events` accepts a mix of UUIDs and exact names.
- **Pagination**: `list_events` and `list_alerts` default to 50 results and return `has_more` / `next_offset` for paging.
- **Cheap reads**: `get_event_rollups` supports `summary_only=true` to return just the statistical summary plus anomalous buckets.
- **Timestamps**: time-series and health responses include `retrieved_at` so staleness can be reasoned about reliably.
- **Secrets**: destination `url` and `credentials` values accept `env:CHIRROP_SECRET_<NAME>` references and are redacted in output. See [Destination secrets](#destination-secrets).
- **Idempotent logging**: `send_logs` returns the `log_id` of every entry (generated if you didn't supply one). If a send fails, retry with the same `log_id`s so nothing is double-counted.
- **Health checks**: `get_stream_health` and `get_agent_summary` compare each policy's threshold against the latest bucket of that policy's own period (minute/hour/day). In `get_agent_summary`, a stream whose data couldn't be fetched shows `status: "error"` with the reason, rather than appearing stale.
- **No deletes**: the ChirrOp API has no delete operations. Retire policies and destinations by setting `enabled: false`; event definitions cannot be removed.

## Tools (27)

### Logs

| Tool | Description |
|------|-------------|
| `send_logs` | Send up to 250 log entries to ChirrOp, with per-entry results including each `log_id` for safe retries |

### Events

| Tool | Description |
|------|-------------|
| `list_events` | List event definitions, filterable by agent/name, with pagination |
| `list_agents` | List distinct agent identities and their event counts |
| `get_event` | Get a single event definition |
| `create_event` | Create a new event definition |
| `update_event` | Update event metadata |
| `get_event_rollups` | Get time-bucketed rollup data (minute/hour/day) with anomaly/trend enrichment; `summary_only` for a cheap overview |
| `get_stream_health` | One-call health check: staleness, active alerts, proximity to each policy's threshold over its own period |
| `get_agent_summary` | Health overview of every event stream produced by an agent; per-stream `error` status if its data can't be fetched |

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
| `list_destinations` | List notification destinations, filterable by channel/enabled state (URLs and credentials redacted) |
| `get_destination` | Get a single destination (URLs and credentials redacted) |
| `create_destination` | Create a notification destination (email/webhook/Slack/Telegram/Discord); secrets may be `env:CHIRROP_SECRET_<NAME>` references |
| `update_destination` | Update a destination, or set `enabled: false` to retire it |
| `test_destination` | Send a test notification and get a test alert_id |

## Resources (8)

| URI | Description |
|-----|-------------|
| `chirrop://events` | All event definitions |
| `chirrop://events/summary` | Events combined with triggered alert counts |
| `chirrop://alerts/triggered` | Currently triggered alerts |
| `chirrop://alerts/{status}` | Alerts filtered by lifecycle status |
| `chirrop://destinations` | All configured destinations (URLs and credentials redacted) |
| `chirrop://events/{event_id}/rollups/{period}` | Time-bucketed rollup data for an event (`event_id` must be a UUID; `period` is minute, hour or day) |
| `chirrop://events/{event_id}/analytics/{period}/{previous}` | Window comparison analytics for an event (`period` is 1h, 1d, 7d or 1m; `previous` is previous_window, previous_1d, previous_7d or previous_1m) |
| `chirrop://agents/{agent}/events` | All events produced by a specific agent |

## Prompts (5)

| Prompt | Description |
|--------|-------------|
| `setup-monitoring` | Guided walkthrough: create event, policy, destination, and verify |
| `triage-alert` | Investigate an alert through a structured triage loop |
| `compare-analytics` | Walk through a window comparison with interpretation |
| `investigate-stream` | End-to-end health check, anomaly scan, trend context, and recommendation |
| `bulk-ingest-review` | Review ingest health across all streams and produce a markdown summary |

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| Every tool returns "CHIRROP_API_KEY is not set" | The server started without the key. Add it to the server's `env` block, or export it in the shell you launch your MCP client from, then restart the server. |
| Every tool returns "CHIRROP_API_KEY is invalid: … must start with 'chp_'" | The key is malformed, or a `${CHIRROP_API_KEY}` placeholder wasn't expanded because the variable wasn't exported when the client started. Fix the value and restart. |
| "Authentication failed … Check that CHIRROP_API_KEY is valid" | The key has the right format but ChirrOp rejected it (revoked, or from another account). |
| `Environment variable "NAME" cannot be referenced: only variables prefixed CHIRROP_SECRET_ are allowed` | Rename the variable to `CHIRROP_SECRET_NAME` in the server's environment, restart, and reference `env:CHIRROP_SECRET_NAME`. |
| `Environment variable "CHIRROP_SECRET_…" … is not set` | The variable is referenced but missing from the server's environment. Add it and restart. |
| Server shows as disconnected in Claude Code | Run `/mcp` to see its status and reconnect. Make sure `npx` (or `node`) is on the PATH of the environment Claude Code runs in. |

## Development

```bash
git clone https://github.com/chirrop/chirrop-mcp
cd chirrop-mcp
npm install
npm run build
```

Run the tests:

```bash
npm test
```

Test with the MCP Inspector:

```bash
CHIRROP_API_KEY=chp_your_key npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
