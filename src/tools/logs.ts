import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@chirropjs/chirrop";
import { z } from "zod";
import { formatError } from "../errors.js";

export function registerLogTools(server: McpServer, client: Client): void {
  server.registerTool(
    "send_logs",
    {
      title: "Send Logs",
      description:
        "Send one or more log entries to ChirrOp. Each entry requires an event name and numeric value. " +
        "Unknown events are auto-created as event definitions. Logs are batched and flushed before returning. " +
        "Max 250 logs per request. Use domain.subject.measure naming (e.g. 'tool.errors.count', 'task.duration_ms').",
      inputSchema: {
        logs: z
          .array(
            z.object({
              log_id: z
                .string()
                .uuid("log_id must be a UUID")
                .optional()
                .describe(
                  "UUID idempotency key. Auto-generated if omitted; generated IDs are returned so a retry can reuse them."
                ),
              agent: z
                .string()
                .optional()
                .describe(
                  "Producer identity, e.g. 'openclaw.main'. Combined with event name to form the unique event definition identity."
                ),
              event: z
                .string()
                .min(1, "Event name must not be empty")
                .describe(
                  "Event name using domain.subject.measure format, e.g. 'tool.errors.count', 'task.duration_ms'. Do not encode time windows into names."
                ),
              value: z
                .number()
                .finite("Value must be a finite number")
                .describe("Numeric value for this log entry."),
              occurred_at: z
                .string()
                .optional()
                .describe(
                  "ISO 8601 timestamp. Must be within the last 30 days and no more than 1 day in the future. Defaults to now."
                ),
              meta: z
                .record(z.unknown())
                .optional()
                .describe(
                  "Additional JSON metadata for inspection context, e.g. { tool_name: 'crm.lookup' }. Max 10 top-level keys, max 1KB."
                ),
            })
          )
          .min(1)
          .max(250)
          .describe("Array of log entries to send."),
      },
      annotations: {
        title: "Send Logs",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ logs }) => {
      try {
        const errors: string[] = [];
        const results: Array<{ index: number; log_id: string; event: string; ok: boolean; error?: string }> = [];
        let queued = 0;

        // client.log() enqueues into an internal batch; validation errors
        // surface here, network errors surface from flush() below.
        // Assign IDs up front so the caller can retry idempotently whatever fails.
        for (const [index, input] of logs.entries()) {
          const entry = { ...input, log_id: input.log_id ?? randomUUID() };
          try {
            await client.log(entry);
            queued++;
            results.push({ index, log_id: entry.log_id, event: entry.event, ok: true });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`Log "${entry.event}": ${message}`);
            results.push({ index, log_id: entry.log_id, event: entry.event, ok: false, error: message });
          }
        }

        let flushError: string | null = null;
        try {
          await client.flush();
        } catch (error) {
          flushError = error instanceof Error ? error.message : String(error);
        }

        if (flushError) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Queued ${queued}/${logs.length} log(s), but the flush to ChirrOp failed: ${flushError}. ` +
                  "Delivery of the queued entries is not confirmed — retry send_logs with the log_id values below so nothing is double-counted." +
                  (errors.length > 0 ? `\nPer-entry failures:\n${errors.join("\n")}` : ""),
              },
              {
                type: "text" as const,
                text: JSON.stringify({ sent: 0, queued, failed: errors.length, results }),
              },
            ],
            isError: true,
          };
        }

        const sent = queued;
        const resultsBlock = {
          type: "text" as const,
          text: JSON.stringify({ sent, failed: errors.length, results }),
        };

        if (errors.length > 0 && sent > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Sent ${sent}/${logs.length} log(s). Failures:\n${errors.join("\n")}`,
              },
              resultsBlock,
            ],
          };
        }

        if (errors.length > 0 && sent === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `All ${logs.length} log(s) failed:\n${errors.join("\n")}`,
              },
              resultsBlock,
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Sent ${sent} log(s) successfully.`,
            },
            resultsBlock,
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: formatError("send logs", error),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
