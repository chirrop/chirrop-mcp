import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerDestinationTools } from "../../src/tools/destinations.js";
import { createMockClient, extractToolHandlers } from "../helpers.js";

describe("registerDestinationTools", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    client = createMockClient();
    registerDestinationTools(server as McpServer, client as unknown as Client);
    handlers = extractToolHandlers(server as unknown as { registerTool: ReturnType<typeof vi.fn> });
  });

  it("registers 5 tools", () => {
    expect((server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool).toHaveBeenCalledTimes(5);
  });

  it("registers all expected tools", () => {
    for (const name of [
      "list_destinations",
      "get_destination",
      "create_destination",
      "update_destination",
      "test_destination",
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });

  describe("list_destinations", () => {
    it("returns JSON on success", async () => {
      const destinations = [{ destination_id: "d1", channel: "slack" }];
      client.listDestinations.mockResolvedValue(destinations);

      const result = await handlers.get("list_destinations")!({}) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text)).toEqual(destinations);
    });

    it("filters client-side by channel and enabled", async () => {
      client.listDestinations.mockResolvedValue([
        { destination_id: "d1", channel: "slack", enabled: true },
        { destination_id: "d2", channel: "email", enabled: true },
        { destination_id: "d3", channel: "slack", enabled: false },
      ]);

      const result = await handlers.get("list_destinations")!({ channel: "slack", enabled: true }) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text)).toEqual([{ destination_id: "d1", channel: "slack", enabled: true }]);
    });
  });

  describe("get_destination", () => {
    it("passes destination_id to SDK", async () => {
      client.getDestination.mockResolvedValue({ destination_id: "d1" });

      await handlers.get("get_destination")!({ destination_id: "d1" });

      expect(client.getDestination).toHaveBeenCalledWith("d1");
    });
  });

  describe("create_destination", () => {
    it("passes full payload to SDK", async () => {
      const payload = {
        channel: "slack",
        url: "https://hooks.slack.com/xxx",
        scope: "all",
        policy_ids: [],
        enabled: true,
      };
      client.createDestination.mockResolvedValue({ destination_id: "d1", ...payload });

      await handlers.get("create_destination")!(payload);

      expect(client.createDestination).toHaveBeenCalledWith(payload);
    });
  });

  describe("env: secret references", () => {
    afterEach(() => {
      delete process.env.CHIRROP_SECRET_SLACK_URL;
      delete process.env.SOME_OTHER_SECRET;
    });

    it("resolves CHIRROP_SECRET_-prefixed variables", async () => {
      process.env.CHIRROP_SECRET_SLACK_URL = "https://hooks.slack.com/services/T/B/x";

      await handlers.get("create_destination")!({
        channel: "slack",
        url: "env:CHIRROP_SECRET_SLACK_URL",
        scope: "all",
        policy_ids: [],
        enabled: true,
      });

      expect(client.createDestination).toHaveBeenCalledWith(
        expect.objectContaining({ url: "https://hooks.slack.com/services/T/B/x" })
      );
    });

    it("refuses variables without the prefix, including the API key", async () => {
      process.env.SOME_OTHER_SECRET = "s3cret";

      for (const name of ["CHIRROP_API_KEY", "SOME_OTHER_SECRET"]) {
        const result = await handlers.get("create_destination")!({
          channel: "webhook",
          url: "https://example.com/hook",
          credentials: { token: `env:${name}` },
          scope: "all",
          policy_ids: [],
          enabled: true,
        }) as { content: Array<{ text: string }>; isError: boolean };

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("CHIRROP_SECRET_");
      }
      expect(client.createDestination).not.toHaveBeenCalled();
    });

    it("rejects unprefixed references in update_destination", async () => {
      const result = await handlers.get("update_destination")!({
        destination_id: "d1",
        url: "env:CHIRROP_API_KEY",
      }) as { isError: boolean };

      expect(result.isError).toBe(true);
      expect(client.updateDestination).not.toHaveBeenCalled();
    });
  });

  describe("redaction", () => {
    const stored = {
      destination_id: "d1",
      channel: "telegram",
      url: "https://hooks.slack.com/services/T/B/x",
      credentials: { bot_token: "123:abc", chat_id: "42", address: "ops@example.com" },
      scope: "all",
      enabled: true,
    };
    const redacted = {
      ...stored,
      url: "https://hooks.slack.com/[redacted]",
      credentials: { bot_token: "[redacted]", chat_id: "42", address: "ops@example.com" },
    };

    it("redacts URL paths and secret credentials in every destination response", async () => {
      client.listDestinations.mockResolvedValue([stored]);
      client.getDestination.mockResolvedValue(stored);
      client.createDestination.mockResolvedValue(stored);
      client.updateDestination.mockResolvedValue(stored);

      const responses = [
        await handlers.get("list_destinations")!({}),
        await handlers.get("get_destination")!({ destination_id: "d1" }),
        await handlers.get("create_destination")!({ channel: "telegram", scope: "all", policy_ids: [], enabled: true }),
        await handlers.get("update_destination")!({ destination_id: "d1", enabled: true }),
      ] as Array<{ content: Array<{ text: string }> }>;

      expect(JSON.parse(responses[0]!.content[0]!.text)).toEqual([redacted]);
      for (const r of responses.slice(1)) {
        expect(JSON.parse(r.content[0]!.text)).toEqual(redacted);
        expect(r.content[0]!.text).not.toContain("123:abc");
      }
    });

    it("leaves a bare-origin URL readable", async () => {
      client.getDestination.mockResolvedValue({ ...stored, url: "https://example.com" });

      const result = await handlers.get("get_destination")!({ destination_id: "d1" }) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0]!.text).url).toBe("https://example.com");
    });
  });

  describe("update_destination", () => {
    it("separates destination_id from payload", async () => {
      client.updateDestination.mockResolvedValue({ destination_id: "d1", enabled: false });

      await handlers.get("update_destination")!({ destination_id: "d1", enabled: false });

      expect(client.updateDestination).toHaveBeenCalledWith("d1", { enabled: false });
    });
  });

  describe("test_destination", () => {
    it("passes destination_id to SDK", async () => {
      const testResult = { alert_id: "a-test", destination_id: "d1", status: "sent" };
      client.testDestination.mockResolvedValue(testResult);

      const result = await handlers.get("test_destination")!({ destination_id: "d1" }) as { content: Array<{ text: string }> };

      expect(client.testDestination).toHaveBeenCalledWith("d1");
      expect(JSON.parse(result.content[0].text)).toEqual(testResult);
    });

    it("returns isError on failure", async () => {
      client.testDestination.mockRejectedValue(new Error("connection refused"));

      const result = await handlers.get("test_destination")!({ destination_id: "d1" }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed");
    });
  });
});
