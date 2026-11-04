import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.prompt(
    "setup-monitoring",
    "Guided walkthrough to set up monitoring for an event: create the event definition, create an alerting policy, create a notification destination, and verify delivery with a test.",
    {
      event_name: z
        .string()
        .describe("The event name to monitor, e.g. 'tool.errors.count'."),
      agent: z
        .string()
        .optional()
        .describe("Producer identity, e.g. 'openclaw.main'."),
      unit: z
        .string()
        .optional()
        .describe("Unit of measurement, e.g. 'ms', 'count'."),
    },
    ({ event_name, agent, unit }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to set up monitoring for the event "${event_name}"${agent ? ` from agent "${agent}"` : ""}.`,
              "",
              "Please walk me through these steps:",
              "",
              `1. **Create the event** definition using create_event with name "${event_name}"${unit ? `, unit "${unit}"` : ""}${agent ? `, agent "${agent}"` : ""}.`,
              "2. **Send a test log** using send_logs to confirm the event is working.",
              "3. **Create a policy** using create_policy. Ask me what aggregate function (sum, count, average, min, max, p95_est, p99_est), condition (gt, lt, eq, gte, lte), threshold, period (minute, hour, day), and severity (info, warning, error, critical) I want.",
              "4. **Create a destination** using create_destination. Ask me what channel (email, webhook, slack, telegram, discord) and configuration I want to use. If a URL or credential is a secret, suggest I set it as an environment variable on the MCP server and pass it as 'env:VAR_NAME' instead of pasting it here.",
              "5. **Test the destination** using test_destination, then check delivery status with get_alert_deliveries using kind='test'.",
              "",
              "Start with step 1 and confirm each step before moving on.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "triage-alert",
    "Investigate and triage a specific alert. Fetches alert details, related event rollups, analytics comparison, and delivery status to help decide whether to acknowledge, resolve, or archive.",
    {
      alert_id: z.string().describe("The alert UUID to triage."),
    },
    ({ alert_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I need to triage alert ${alert_id}. Please follow this investigation loop:`,
              "",
              `1. **Get alert details**: Call get_alert with alert_id="${alert_id}". Show me the event name, severity, status, threshold, condition, aggregate, and the actual value that triggered it.`,
              "",
              "2. **Check event rollups**: Using the event_id from the alert, call get_event_rollups with the same period as the policy to see the recent data trend.",
              "",
              "3. **Compare analytics**: Call get_event_analytics for the same event with period='1h' and previous='previous_window' to understand whether this is a new spike or ongoing trend.",
              "",
              "4. **Check delivery status**: Call get_alert_deliveries for this alert to see if notifications were sent successfully.",
              "",
              "5. **Recommend action**: Based on the data, recommend one of:",
              "   - **acknowledge_alert** if this needs human investigation",
              "   - **resolve_alert** if the issue has subsided",
              "   - **archive_alert** if this is a false positive or expected behavior",
              "",
              "Explain your reasoning at each step.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "compare-analytics",
    "Walk through a window comparison for an event, interpreting value deltas, count changes, mean shifts, and standard deviation changes.",
    {
      event_id: z.string().describe("The event UUID to analyze."),
      period: z
        .enum(["1h", "1d", "7d", "1m"])
        .describe("Current window size."),
      previous: z
        .enum([
          "previous_window",
          "previous_1d",
          "previous_7d",
          "previous_1m",
        ])
        .describe("Comparison window."),
    },
    ({ event_id, period, previous }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Please analyze event ${event_id} by comparing the ${period} window against ${previous}.`,
              "",
              `1. **Fetch analytics**: Call get_event_analytics with event_id="${event_id}", period="${period}", previous="${previous}".`,
              "",
              "2. **Interpret the comparison**:",
              "   - **Value delta & pct change**: Is the total value increasing or decreasing? By how much?",
              "   - **Count delta & pct change**: Are there more or fewer events? This indicates volume changes.",
              "   - **Mean delta & pct change**: Is the average per-event value shifting? This indicates per-event magnitude changes.",
              "   - **Stddev comparison**: Is the current standard deviation higher? Higher stddev means more variance.",
              "   - **_interpretation block**: Check the summary sentence for a plain-language signal.",
              "",
              "3. **Get event details**: Call get_event to understand what this event tracks (unit, description).",
              "",
              "4. **Check policies**: Call list_policies and filter for this event_id. Are any policy thresholds close to being breached given the current trend?",
              "",
              "5. **Summary**: Provide a plain-language summary of the event health and any recommended actions.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "investigate-stream",
    "End-to-end investigation of a numeric event stream: health check, anomaly detection, trend context, policy review, and recommendation.",
    {
      event_id: z.string().describe("The event UUID to investigate."),
      period: z
        .enum(["minute", "hour", "day"])
        .optional()
        .describe("Rollup granularity for anomaly analysis. Defaults to 'hour'."),
    },
    ({ event_id, period }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Investigate event stream ${event_id} using this workflow:`,
              "",
              `1. **Health check**: Call get_stream_health(event_id="${event_id}"). Report status, staleness, active alerts, and any policies approaching their threshold.`,
              "",
              `2. **Anomaly scan**: Call detect_anomalies(event_id="${event_id}", period="${period ?? "hour"}", threshold_sigma=2.0). Show the anomalous buckets and their deviation in sigmas. Note whether has_sufficient_data is true.`,
              "",
              `3. **Trend context**: Call get_event_analytics(event_id="${event_id}", period="1d", previous="previous_window"). Check the _interpretation.summary to confirm whether the anomalies represent a new pattern or a continuation.`,
              "",
              "4. **Policy check**: Call list_policies and filter for this event_id. Are any thresholds too tight (triggering on normal variance) or too loose (missing real spikes)?",
              "",
              "5. **Recommendation**: Based on the full picture, recommend one of:",
              "   - (a) Adjust a policy threshold and explain the suggested value",
              "   - (b) Acknowledge or resolve existing alerts",
              "   - (c) No action needed — explain why the stream looks healthy",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "bulk-ingest-review",
    "Review ingest health across all event streams: flag silent events, flag outlier-volume events, and produce a markdown summary table.",
    {},
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Review ingest health across all monitored event streams using this workflow:",
              "",
              "1. **List all events**: Call list_events. Note the total count.",
              "",
              "2. **Check summary**: Read resource chirrop://events/summary to identify events with active triggered alerts.",
              "",
              "3. **Compare streams**: Call compare_events with all event_ids (up to 10), period='hour', limit=24. If there are more than 10 events, use the ones with active alerts plus a representative sample.",
              "",
              "4. **Flag silent streams**: Any stream whose last_bucket_at is more than 2 hours ago (or null) is 'SILENT'. List them.",
              "",
              "5. **Flag outlier volumes**: Any stream whose mean is more than 2 standard deviations above the cross-stream mean is a 'HIGH VOLUME OUTLIER'. List them.",
              "",
              "6. **Summary table**: Produce a markdown table with columns: Event Name | Last Data | Hourly Mean | Anomaly Count | Status.",
              "   Status values: HEALTHY, STALE, ALERT_ACTIVE, HIGH_VOLUME.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
