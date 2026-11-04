# Your AI Agent Is Flying Blind

## Adding statistical monitoring to Claude and OpenClaw with chirrop-mcp

When an OpenClaw agent runs autonomously — clearing your inbox, filing PRs, polling APIs at 3am — you have no native visibility into whether it's behaving normally. It either works or it doesn't. There's no "task.duration_ms trended 40% slower this week" or "tool.errors.count spiked at 2am and nobody noticed."

That's the gap chirrop-mcp closes. It's a Model Context Protocol server that gives Claude Code (and by extension, OpenClaw) direct access to ChirrOp's monitoring platform: send telemetry, define alerting policies, triage alerts, and now — with a set of new tools — actually *reason* about numeric event streams with statistical rigour.

This post walks through what we built and why.

---

## The problem with pull-based monitoring

Before these changes, chirrop-mcp was entirely pull-based. Claude could call `get_event_rollups` and get back raw bucket data, but it had to do all the analysis itself: is this normal? Is it trending up? Which specific buckets were unusual?

That's a lot of reasoning work for every monitoring question. And because the raw `EventLogPoint` type already contains `count`, `value` (sum), and `squares` (sum of squares), everything needed to compute population standard deviation was already there — we just weren't using it.

The formula: `variance = (squares / count) - mean²`. No extra API calls. The data was always rich enough; we just needed to enrich the response.

---

## What changed

### Statistical enrichment of rollups

`get_event_rollups` now returns a structured response instead of a raw array:

```json
{
  "points": [
    {
      "occurred_at": "2026-06-30T14:00:00Z",
      "count": 142,
      "value": 18634,
      "_mean": 131.2,
      "_stddev": 14.3,
      "_is_anomaly": false,
      "_trend_direction": "stable"
    },
    {
      "occurred_at": "2026-06-30T15:00:00Z",
      "count": 139,
      "value": 46821,
      "_mean": 336.8,
      "_stddev": 89.1,
      "_is_anomaly": true,
      "_trend_direction": "up"
    }
  ],
  "_summary": {
    "global_mean": 134.6,
    "global_stddev": 18.2,
    "anomaly_count": 1,
    "trend_direction": "stable",
    "threshold_sigma": 2.0,
    "bucket_count": 24
  }
}
```

The optional `threshold_sigma` input controls sensitivity. Default is 2.0 (flag anything more than two standard deviations from the global mean). Tighten it to 1.5 for sensitive streams, loosen to 3.0 for inherently noisy ones.

---

### detect_anomalies

A purpose-built tool that answers "which specific time buckets were anomalous?" without chaining multiple calls:

```
detect_anomalies(
  event_id: "...",
  period: "hour",
  limit: 168,         // one week of hourly buckets
  threshold_sigma: 2.0
)
```

Returns the flagged buckets with their deviation in sigmas and direction (`spike` or `drop`), plus a `has_sufficient_data` flag (false when fewer than 10 buckets — stddev is unreliable with small samples).

This is the tool to reach for when triage-alert tells you something fired but you want to understand the shape of the data around it.

---

### get_stream_health

Three concurrent API calls (recent logs, triggered alerts, policies) collapsed into one response:

```json
{
  "event_id": "...",
  "status": "alert_active",
  "last_data_at": "2026-06-30T21:44:00Z",
  "minutes_since_last_data": 8,
  "is_stale": false,
  "active_alert_count": 1,
  "active_alerts": [
    { "alert_id": "...", "severity": "error", "triggered_at": "..." }
  ],
  "policy_proximity": [
    {
      "policy_id": "...",
      "aggregate": "average",
      "threshold": 200,
      "last_bucket_value": 183,
      "proximity_pct": 91.5,
      "approaching_threshold": true
    }
  ]
}
```

Status rolls up to one of four values: `healthy`, `stale`, `alert_active`, or `degraded` (both stale and alerting). Policy proximity shows how close current values are to each threshold — useful for catching problems before they cross the line.

---

### get_event_analytics with _interpretation

The existing analytics tool compares two time windows and returns deltas and percentage changes. It now appends an `_interpretation` block with plain-language signals computed from those numbers:

```json
{
  "_interpretation": {
    "value_signal": "significant_increase",
    "count_signal": "moderate_increase",
    "mean_signal": "moderate_increase",
    "volatility_change": "much_higher_variance",
    "summary": "Total value significant increase (+34.0%); event count moderate increase (+12.0%); per-event mean moderate increase (+8.2%); much higher variance."
  }
}
```

This means Claude can read a single sentence to understand the window comparison rather than reasoning through four separate delta fields. The thresholds are calibrated separately for value (10%/25%), count (10%/25%), and mean (5%/15%) changes — mean shifts matter at smaller magnitudes.

---

### compare_events

Fetch rollups for 2–10 event IDs over the same period and get a side-by-side statistical table:

```
compare_events(
  event_ids: ["task.duration_ms", "task.token_count", "tool.errors.count"],
  period: "hour",
  limit: 24
)
```

Each stream entry includes its global mean, stddev, trend direction, last value, and anomaly count at the 2σ threshold. The primary use case: when an alert fires, quickly see whether correlated streams are also moving — is the latency spike accompanied by an error count spike, or is it isolated?

---

## The OpenClaw angle

OpenClaw agents are event producers. Every task an OpenClaw skill runs is a potential telemetry point: how long did it take, did it succeed, how many tokens did it consume, how many retries were needed?

The `agent` field in ChirrOp maps directly to the OpenClaw instance or skill name — `openclaw.main`, `openclaw.scheduler`, `openclaw.email-skill` — which means you can monitor each independently.

### get_agent_summary

The new `get_agent_summary` tool answers "how is my openclaw.main agent performing right now?" in a single call:

```
get_agent_summary(agent: "openclaw.main")
```

It filters all events to those produced by the named agent, fetches the most recent data point for each concurrently, joins with triggered alerts and policies, and returns a per-stream status rollup plus a top-level `overall_health` field.

```json
{
  "agent": "openclaw.main",
  "event_count": 4,
  "overall_health": "needs_attention",
  "status_summary": { "healthy": 3, "alert_active": 1 },
  "streams": [
    { "event": "task.duration_ms", "status": "healthy", "minutes_since_last_data": 3 },
    { "event": "task.errors.count", "status": "alert_active", "active_alert_count": 1 },
    { "event": "task.token_count", "status": "healthy", "minutes_since_last_data": 3 },
    { "event": "tool.calls.count", "status": "healthy", "minutes_since_last_data": 3 }
  ]
}
```

### Resources

Two new passive resources make this accessible without a tool call:

- `chirrop://agents/{agent}/events` — all event definitions for a named agent
- `chirrop://events/summary` — combined snapshot across all events with triggered alert counts

Claude can read these as context before deciding whether to invoke a more expensive tool.

---

## The monitoring loop in practice

The intended workflow for an OpenClaw agent monitoring itself:

**1. Instrument the skill.** Each skill sends a log entry on completion:

```javascript
await client.log({
  agent: "openclaw.main",
  event: "task.duration_ms",
  value: elapsedMs,
  occurred_at: new Date().toISOString()
})
```

**2. Set a policy.** Define what "anomalous" means for this stream — average duration greater than 5000ms triggers a warning.

**3. Use the investigate-stream prompt.** When something looks off, this guided prompt runs health check → anomaly scan → analytics trend → policy review → recommendation in sequence, without needing to manually chain five tool calls.

**4. Let OpenClaw close the loop.** With `CHIRROP_POLL_ALERTS=true`, the MCP server polls for new triggered alerts and emits MCP notifications, which OpenClaw can pick up and push to the user via Telegram, Slack, or whichever messaging platform they prefer.

---

## New in this release

| Added | Type | Purpose |
|---|---|---|
| `get_event_rollups` enrichment | Tool update | Per-bucket stats + anomaly flags |
| `get_event_analytics` `_interpretation` | Tool update | Plain-language window comparison signals |
| `detect_anomalies` | New tool | Find outlier buckets by sigma threshold |
| `get_stream_health` | New tool | One-call health check (recency + alerts + policies) |
| `compare_events` | New tool | Side-by-side stats across 2–10 streams |
| `get_agent_summary` | New tool | All streams for a named agent, health rolled up |
| `chirrop://events/summary` | New resource | Cross-event snapshot with alert counts |
| `chirrop://events/{id}/analytics/{period}/{prev}` | New resource | Analytics as a readable resource |
| `chirrop://agents/{agent}/events` | New resource | All events scoped to a named agent |
| `investigate-stream` | New prompt | 5-step guided stream investigation |
| `bulk-ingest-review` | New prompt | Cross-stream ingest health sweep |

The statistics (mean, stddev, anomaly detection) are computed in-process from the `value`, `count`, and `squares` fields already returned by the API — no additional calls, no external dependencies.

---

## Getting started

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "chirrop": {
      "command": "npx",
      "args": ["-y", "@chirropjs/chirrop-mcp"],
      "env": {
        "CHIRROP_API_KEY": "your-key-here"
      }
    }
  }
}
```

For OpenClaw, use `openclaw.{skill-name}` as the `agent` value when calling `send_logs`. Then `get_agent_summary(agent: "openclaw.{skill-name}")` gives you the full picture on demand.
