import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@chirropjs/chirrop";
import { z } from "zod";
import { formatError } from "../errors.js";

const DESTINATION_NOT_FOUND_HINT = "Call list_destinations to see valid destination IDs.";

// Only variables with this prefix may be referenced, so an env: reference
// can't be used to exfiltrate CHIRROP_API_KEY or other server secrets.
export const SECRET_ENV_PREFIX = "CHIRROP_SECRET_";

const ENV_REF_DESCRIPTION =
  `String values may be given as 'env:${SECRET_ENV_PREFIX}<NAME>' to read the real value from the MCP server's environment, ` +
  `keeping secrets out of the conversation. Only variables prefixed ${SECRET_ENV_PREFIX} can be referenced.`;

// Credential keys that identify a recipient rather than authenticate, so they stay visible.
const NON_SECRET_CREDENTIAL_KEYS = new Set(["address", "chat_id"]);
const REDACTED = "[redacted]";

function resolveSecret(value: string): string {
  if (!value.startsWith("env:")) return value;
  const name = value.slice(4);
  if (!name.startsWith(SECRET_ENV_PREFIX)) {
    throw new Error(
      `Environment variable "${name}" cannot be referenced: only variables prefixed ${SECRET_ENV_PREFIX} are allowed. ` +
        `Expose the secret to the MCP server as ${SECRET_ENV_PREFIX}<NAME> and pass "env:${SECRET_ENV_PREFIX}<NAME>".`
    );
  }
  const resolved = process.env[name];
  if (!resolved) {
    throw new Error(
      `Environment variable "${name}" (referenced as "env:${name}") is not set in the MCP server's environment. ` +
        "Add it to the server's env configuration and restart, or pass the literal value."
    );
  }
  return resolved;
}

function resolveCredentials(
  credentials: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!credentials) return credentials;
  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => [
      key,
      typeof value === "string" ? resolveSecret(value) : value,
    ])
  );
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" && !parsed.search ? parsed.origin : `${parsed.origin}/${REDACTED}`;
  } catch {
    return REDACTED;
  }
}

/** Mask webhook URL paths and credential values so resolved secrets never reach the conversation. */
export function redactDestination<T>(destination: T): T {
  if (!destination || typeof destination !== "object") return destination;
  const d = { ...(destination as Record<string, unknown>) };
  if (typeof d.url === "string") d.url = redactUrl(d.url);
  if (d.credentials && typeof d.credentials === "object") {
    d.credentials = Object.fromEntries(
      Object.entries(d.credentials as Record<string, unknown>).map(([key, value]) => [
        key,
        NON_SECRET_CREDENTIAL_KEYS.has(key) ? value : REDACTED,
      ])
    );
  }
  return d as T;
}

export function registerDestinationTools(
  server: McpServer,
  client: Client
): void {
  server.registerTool("list_destinations", {
    title: "List Destinations",
    description: "List configured notification destinations (email, webhook, Slack, Telegram, Discord) and their delivery status, optionally filtered by channel or enabled state.",
    inputSchema: {
      channel: z.enum(["email", "webhook", "slack", "telegram", "discord"]).optional().describe("Only return destinations of this channel type."),
      enabled: z.boolean().optional().describe("Only return destinations with this enabled state."),
    },
    annotations: {
      title: "List Destinations",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ channel, enabled }) => {
    try {
      let destinations = await client.listDestinations();
      if (channel) destinations = destinations.filter((d) => d.channel === channel);
      if (enabled !== undefined) destinations = destinations.filter((d) => d.enabled === enabled);
      return { content: [{ type: "text" as const, text: JSON.stringify(destinations.map(redactDestination)) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("list destinations", error) }], isError: true };
    }
  });

  server.registerTool("get_destination", {
    title: "Get Destination",
    description: "Get a single destination configuration by its UUID, including last delivery status and any errors.",
    inputSchema: {
      destination_id: z.string().uuid("Must be a valid UUID.").describe("The destination UUID."),
    },
    annotations: {
      title: "Get Destination",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  }, async ({ destination_id }) => {
    try {
      const destination = await client.getDestination(destination_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(redactDestination(destination), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("get destination", error, DESTINATION_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("create_destination", {
    title: "Create Destination",
    description:
      "Create a new notification destination. Destinations receive alert notifications when policies trigger. " +
      "Always call test_destination after creation to verify delivery works. " +
      "Channel types: 'slack' (requires url), 'discord' (requires url), 'webhook' (requires url), " +
      "'telegram' (requires credentials.bot_token and credentials.chat_id), 'email' (requires credentials.address). " +
      `Prefer 'env:${SECRET_ENV_PREFIX}<NAME>' references for url and credential values so secrets stay out of the conversation; ` +
      "returned URLs and credentials are redacted. " +
      "Destinations cannot be deleted; to retire one, set enabled=false via update_destination.",
    inputSchema: {
      channel: z
        .enum(["email", "webhook", "slack", "telegram", "discord"])
        .describe("Delivery channel type."),
      url: z
        .string()
        .optional()
        .describe(
          "Webhook/Slack/Discord URL. Required for webhook, slack, and discord channels. " + ENV_REF_DESCRIPTION
        ),
      credentials: z
        .record(z.unknown())
        .optional()
        .describe(
          "Channel-specific credentials. Telegram: { bot_token: '...', chat_id: '...' }. Email: { address: '...' }. " +
            ENV_REF_DESCRIPTION
        ),
      scope: z
        .string()
        .describe("'all' routes every alert; 'policies' routes only alerts from the policies listed in policy_ids."),
      policy_ids: z
        .array(z.string().uuid("Each policy_id must be a valid UUID."))
        .describe("Policy UUIDs to route to this destination when scope is 'policies'. Pass an empty array when scope is 'all'."),
      enabled: z.boolean().describe("Whether this destination is active."),
    },
    annotations: {
      title: "Create Destination",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  }, async ({ url, credentials, ...params }) => {
    try {
      const destination = await client.createDestination({
        ...params,
        url: url !== undefined ? resolveSecret(url) : undefined,
        credentials: resolveCredentials(credentials),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(redactDestination(destination), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("create destination", error) }], isError: true };
    }
  });

  server.registerTool("update_destination", {
    title: "Update Destination",
    description:
      "Update an existing notification destination. Only provided fields are changed. " +
      "There is no delete_destination; set enabled=false to retire one. " +
      ENV_REF_DESCRIPTION,
    inputSchema: {
      destination_id: z.string().uuid("Must be a valid UUID.").describe("The destination UUID to update."),
      channel: z.enum(["email", "webhook", "slack", "telegram", "discord"]).optional().describe("Updated channel type."),
      url: z.string().optional().describe(`Updated webhook/Slack/Discord URL. Accepts 'env:${SECRET_ENV_PREFIX}<NAME>' references.`),
      credentials: z.record(z.unknown()).optional().describe(`Updated credentials. String values accept 'env:${SECRET_ENV_PREFIX}<NAME>' references.`),
      scope: z.string().optional().describe("Updated scope: 'all' or 'policies'."),
      policy_ids: z.array(z.string().uuid("Each policy_id must be a valid UUID.")).optional().describe("Updated policy UUIDs (used when scope is 'policies')."),
      enabled: z.boolean().optional().describe("Updated enabled state. Set false to retire the destination (there is no delete)."),
    },
    annotations: {
      title: "Update Destination",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  }, async ({ destination_id, url, credentials, ...payload }) => {
    try {
      const destination = await client.updateDestination(destination_id, {
        ...payload,
        ...(url !== undefined ? { url: resolveSecret(url) } : {}),
        ...(credentials !== undefined ? { credentials: resolveCredentials(credentials) } : {}),
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(redactDestination(destination), null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("update destination", error, DESTINATION_NOT_FOUND_HINT) }], isError: true };
    }
  });

  server.registerTool("test_destination", {
    title: "Test Destination",
    description:
      "Send a test notification to verify a destination works. Returns a synthetic alert_id. " +
      "After testing, call get_alert_deliveries with that alert_id and kind='test' to check delivery status.",
    inputSchema: {
      destination_id: z.string().uuid("Must be a valid UUID.").describe("The destination UUID to test."),
    },
    annotations: {
      title: "Test Destination",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  }, async ({ destination_id }) => {
    try {
      const result = await client.testDestination(destination_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: formatError("test destination", error, DESTINATION_NOT_FOUND_HINT) }], isError: true };
    }
  });
}
