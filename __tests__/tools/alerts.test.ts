import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerAlertTools } from "../../src/tools/alerts.js";
import { createMockClient, extractToolHandlers } from "../helpers.js";

describe("registerAlertTools", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    client = createMockClient();
    registerAlertTools(server as McpServer, client as unknown as Client);
    handlers = extractToolHandlers(server as unknown as { registerTool: ReturnType<typeof vi.fn> });
  });

  it("registers 6 tools", () => {
    expect((server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool).toHaveBeenCalledTimes(6);
  });

  it("registers all expected tools", () => {
    for (const name of [
      "list_alerts",
      "get_alert",
      "get_alert_deliveries",
      "acknowledge_alert",
      "resolve_alert",
      "archive_alert",
    ]) {
      expect(handlers.has(name)).toBe(true);
    }
  });

  describe("list_alerts", () => {
    it("passes status filter to SDK", async () => {
      client.listAlerts.mockResolvedValue([]);

      await handlers.get("list_alerts")!({ status: "triggered" });

      expect(client.listAlerts).toHaveBeenCalledWith("triggered");
    });

    it("works without status filter", async () => {
      client.listAlerts.mockResolvedValue([]);

      await handlers.get("list_alerts")!({ status: undefined });

      expect(client.listAlerts).toHaveBeenCalledWith(undefined);
    });

    it("returns paginated results wrapper", async () => {
      const alerts = [{ alert_id: "a1", event_id: "e1" }];
      client.listAlerts.mockResolvedValue(alerts);

      const result = await handlers.get("list_alerts")!({}) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual({
        total: 1,
        returned: 1,
        offset: 0,
        has_more: false,
        next_offset: null,
        alerts,
      });
    });

    it("filters client-side by event_id", async () => {
      client.listAlerts.mockResolvedValue([
        { alert_id: "a1", event_id: "e1" },
        { alert_id: "a2", event_id: "e2" },
      ]);

      const result = await handlers.get("list_alerts")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(1);
      expect(parsed.alerts).toEqual([{ alert_id: "a1", event_id: "e1" }]);
    });

    it("paginates with limit and offset", async () => {
      client.listAlerts.mockResolvedValue([
        { alert_id: "a1" }, { alert_id: "a2" }, { alert_id: "a3" },
      ]);

      const result = await handlers.get("list_alerts")!({ limit: 1, offset: 1 }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(3);
      expect(parsed.alerts).toEqual([{ alert_id: "a2" }]);
    });
  });

  describe("get_alert", () => {
    it("passes alert_id to SDK", async () => {
      const alert = { alert_id: "a1", status: "triggered" };
      client.getAlert.mockResolvedValue(alert);

      const result = await handlers.get("get_alert")!({ alert_id: "a1" }) as { content: Array<{ text: string }> };

      expect(client.getAlert).toHaveBeenCalledWith("a1");
      expect(JSON.parse(result.content[0].text)).toEqual(alert);
    });
  });

  describe("get_alert_deliveries", () => {
    it("passes alert_id and options to SDK", async () => {
      client.getAlertDeliveries.mockResolvedValue([]);

      await handlers.get("get_alert_deliveries")!({
        alert_id: "a1",
        kind: "test",
        limit: 10,
      });

      expect(client.getAlertDeliveries).toHaveBeenCalledWith("a1", {
        kind: "test",
        limit: 10,
      });
    });
  });

  describe("acknowledge_alert", () => {
    it("calls acknowledgeAlert on SDK", async () => {
      client.acknowledgeAlert.mockResolvedValue({ alert_id: "a1", status: "acknowledged" });

      await handlers.get("acknowledge_alert")!({ alert_id: "a1" });

      expect(client.acknowledgeAlert).toHaveBeenCalledWith("a1");
    });
  });

  describe("resolve_alert", () => {
    it("calls resolveAlert on SDK", async () => {
      client.resolveAlert.mockResolvedValue({ alert_id: "a1", status: "resolved" });

      await handlers.get("resolve_alert")!({ alert_id: "a1" });

      expect(client.resolveAlert).toHaveBeenCalledWith("a1");
    });
  });

  describe("archive_alert", () => {
    it("calls archiveAlert on SDK", async () => {
      client.archiveAlert.mockResolvedValue({ alert_id: "a1", status: "archived" });

      await handlers.get("archive_alert")!({ alert_id: "a1" });

      expect(client.archiveAlert).toHaveBeenCalledWith("a1");
    });

    it("returns isError on failure", async () => {
      client.archiveAlert.mockRejectedValue(new Error("rate limit 429"));

      const result = await handlers.get("archive_alert")!({ alert_id: "a1" }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Rate limited");
    });
  });
});
