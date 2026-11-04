import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerEventTools } from "../../src/tools/events.js";
import { createMockClient, extractToolHandlers } from "../helpers.js";

describe("registerEventTools", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    client = createMockClient();
    registerEventTools(server as McpServer, client as unknown as Client);
    handlers = extractToolHandlers(server as unknown as { registerTool: ReturnType<typeof vi.fn> });
  });

  it("registers 8 tools", () => {
    expect((server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool).toHaveBeenCalledTimes(8);
  });

  it("registers all expected tools", () => {
    expect(handlers.has("list_events")).toBe(true);
    expect(handlers.has("list_agents")).toBe(true);
    expect(handlers.has("get_event")).toBe(true);
    expect(handlers.has("create_event")).toBe(true);
    expect(handlers.has("update_event")).toBe(true);
    expect(handlers.has("get_event_rollups")).toBe(true);
    expect(handlers.has("get_stream_health")).toBe(true);
    expect(handlers.has("get_agent_summary")).toBe(true);
  });

  describe("list_events", () => {
    it("returns paginated JSON on success", async () => {
      const events = [{ event_id: "e1", event: "test.count" }];
      client.listEvents.mockResolvedValue(events);

      const result = await handlers.get("list_events")!({}) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text)).toEqual({
        total: 1,
        returned: 1,
        offset: 0,
        has_more: false,
        next_offset: null,
        events,
      });
    });

    it("filters by agent and name_contains", async () => {
      const events = [
        { event_id: "e1", event: "task.duration_ms", agent: "openclaw.main" },
        { event_id: "e2", event: "task.errors.count", agent: "openclaw.main" },
        { event_id: "e3", event: "other.event", agent: "other.agent" },
      ];
      client.listEvents.mockResolvedValue(events);

      const result = await handlers.get("list_events")!({ agent: "openclaw.main", name_contains: "errors" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(1);
      expect(parsed.events).toEqual([events[1]]);
    });

    it("paginates with limit and offset", async () => {
      const events = [
        { event_id: "e1", event: "a" },
        { event_id: "e2", event: "b" },
        { event_id: "e3", event: "c" },
      ];
      client.listEvents.mockResolvedValue(events);

      const result = await handlers.get("list_events")!({ limit: 1, offset: 1 }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.total).toBe(3);
      expect(parsed.returned).toBe(1);
      expect(parsed.events).toEqual([events[1]]);
    });

    it("returns isError on failure", async () => {
      client.listEvents.mockRejectedValue(new Error("unauthorized 401"));

      const result = await handlers.get("list_events")!({}) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Authentication failed");
    });
  });

  describe("list_agents", () => {
    it("returns distinct agents with event counts", async () => {
      client.listEvents.mockResolvedValue([
        { event_id: "e1", event: "a", agent: "openclaw.main" },
        { event_id: "e2", event: "b", agent: "openclaw.main" },
        { event_id: "e3", event: "c", agent: "other.agent" },
        { event_id: "e4", event: "d" },
      ]);

      const result = await handlers.get("list_agents")!({}) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.agent_count).toBe(2);
      expect(parsed.agents).toEqual([
        { agent: "openclaw.main", event_count: 2 },
        { agent: "other.agent", event_count: 1 },
      ]);
    });

    it("returns isError on failure", async () => {
      client.listEvents.mockRejectedValue(new Error("unauthorized 401"));

      const result = await handlers.get("list_agents")!({}) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe("get_event", () => {
    it("passes event_id to SDK", async () => {
      const event = { event_id: "e1", event: "test.count" };
      client.getEvent.mockResolvedValue(event);

      const result = await handlers.get("get_event")!({ event_id: "e1" }) as { content: Array<{ text: string }> };

      expect(client.getEvent).toHaveBeenCalledWith("e1");
      expect(JSON.parse(result.content[0].text)).toEqual(event);
    });
  });

  describe("create_event", () => {
    it("passes payload to SDK", async () => {
      const payload = { event: "new.event", unit: "ms" };
      const created = { event_id: "e2", ...payload };
      client.createEvent.mockResolvedValue(created);

      const result = await handlers.get("create_event")!(payload) as { content: Array<{ text: string }> };

      expect(client.createEvent).toHaveBeenCalledWith(payload);
      expect(JSON.parse(result.content[0].text)).toEqual(created);
    });
  });

  describe("update_event", () => {
    it("separates event_id from payload", async () => {
      const updated = { event_id: "e1", event: "renamed" };
      client.updateEvent.mockResolvedValue(updated);

      await handlers.get("update_event")!({ event_id: "e1", event: "renamed" });

      expect(client.updateEvent).toHaveBeenCalledWith("e1", { event: "renamed" });
    });
  });

  describe("get_event_rollups", () => {
    it("passes event_id and options, returns enriched response", async () => {
      const rollups = [{ event_id: "e1", period: "hour", count: 10, value: 100, squares: 1100, min: 8, max: 12, occurred_at: "2024-01-01T00:00:00Z" }];
      client.getEventLogs.mockResolvedValue(rollups);

      const result = await handlers.get("get_event_rollups")!({
        event_id: "e1",
        period: "hour",
        limit: 50,
      }) as { content: Array<{ text: string }> };

      expect(client.getEventLogs).toHaveBeenCalledWith("e1", { period: "hour", limit: 50 });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("points");
      expect(parsed).toHaveProperty("_summary");
      expect(parsed.points[0]).toMatchObject({ event_id: "e1", period: "hour", count: 10 });
      expect(parsed.points[0]).toHaveProperty("_mean");
      expect(parsed.points[0]).toHaveProperty("_stddev");
      expect(parsed.points[0]).toHaveProperty("_is_anomaly");
      expect(parsed.points[0]).toHaveProperty("_trend_direction");
      expect(parsed._summary).toHaveProperty("global_mean");
      expect(parsed._summary).toHaveProperty("anomaly_count");
      expect(parsed._summary.bucket_count).toBe(1);
    });

    it("uses threshold_sigma from input", async () => {
      const rollups = [
        { count: 10, value: 100, squares: 1000, occurred_at: "2024-01-01T00:00:00Z" },
        { count: 10, value: 100, squares: 1000, occurred_at: "2024-01-01T01:00:00Z" },
        { count: 10, value: 1000, squares: 100000, occurred_at: "2024-01-01T02:00:00Z" }, // spike
      ];
      client.getEventLogs.mockResolvedValue(rollups);

      const result = await handlers.get("get_event_rollups")!({
        event_id: "e1",
        threshold_sigma: 1.0,
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed._summary.threshold_sigma).toBe(1.0);
      expect(parsed._summary.anomaly_count).toBeGreaterThan(0);
    });

    it("handles 404 errors", async () => {
      client.getEventLogs.mockRejectedValue(new Error("Not Found 404"));

      const result = await handlers.get("get_event_rollups")!({
        event_id: "missing",
      }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("get_stream_health", () => {
    it("returns healthy status when data is recent and no alerts", async () => {
      const recentOccurredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      client.getEventLogs.mockResolvedValue([{ occurred_at: recentOccurredAt, count: 5, value: 50 }]);
      client.listAlerts.mockResolvedValue([]);
      client.listPolicies.mockResolvedValue([]);

      const result = await handlers.get("get_stream_health")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.status).toBe("healthy");
      expect(parsed.is_stale).toBe(false);
      expect(parsed.active_alert_count).toBe(0);
    });

    it("returns stale status when no recent data", async () => {
      client.getEventLogs.mockResolvedValue([]);
      client.listAlerts.mockResolvedValue([]);
      client.listPolicies.mockResolvedValue([]);

      const result = await handlers.get("get_stream_health")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.status).toBe("stale");
      expect(parsed.is_stale).toBe(true);
      expect(parsed.last_data_at).toBeNull();
    });

    it("returns alert_active when triggered alerts exist for the event", async () => {
      const recentOccurredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      client.getEventLogs.mockResolvedValue([{ occurred_at: recentOccurredAt, count: 5, value: 50 }]);
      client.listAlerts.mockResolvedValue([
        { alert_id: "a1", event_id: "e1", severity: "warning", status: "triggered", triggered_at: "2024-01-01T00:00:00Z" },
        { alert_id: "a2", event_id: "other", severity: "info", status: "triggered", triggered_at: "2024-01-01T00:00:00Z" },
      ]);
      client.listPolicies.mockResolvedValue([]);

      const result = await handlers.get("get_stream_health")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.status).toBe("alert_active");
      expect(parsed.active_alert_count).toBe(1);
      expect(parsed.active_alerts[0].alert_id).toBe("a1");
    });

    it("returns degraded when both stale and alert active", async () => {
      client.getEventLogs.mockResolvedValue([]);
      client.listAlerts.mockResolvedValue([
        { alert_id: "a1", event_id: "e1", severity: "error", status: "triggered", triggered_at: "2024-01-01T00:00:00Z" },
      ]);
      client.listPolicies.mockResolvedValue([]);

      const result = await handlers.get("get_stream_health")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.status).toBe("degraded");
    });

    it("includes policy proximity for sum aggregate", async () => {
      const recentOccurredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      client.getEventLogs.mockResolvedValue([{ occurred_at: recentOccurredAt, count: 5, value: 80, squares: 1300 }]);
      client.listAlerts.mockResolvedValue([]);
      client.listPolicies.mockResolvedValue([
        { policy_id: "p1", event_id: "e1", title: "High sum", aggregate: "sum", condition: "gt", threshold: 100 },
      ]);

      const result = await handlers.get("get_stream_health")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.policy_proximity).toHaveLength(1);
      expect(parsed.policy_proximity[0].last_bucket_value).toBe(80);
      expect(parsed.policy_proximity[0].proximity_pct).toBeCloseTo(80);
      expect(parsed.policy_proximity[0].approaching_threshold).toBe(true);
    });

    it("returns isError on failure", async () => {
      client.getEventLogs.mockRejectedValue(new Error("server error"));

      const result = await handlers.get("get_stream_health")!({ event_id: "e1" }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe("get_agent_summary", () => {
    it("returns summary for all events matching the agent", async () => {
      const recentAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      client.listEvents.mockResolvedValue([
        { event_id: "e1", agent: "openclaw.main", event: "task.duration_ms", unit: "ms" },
        { event_id: "e2", agent: "openclaw.main", event: "task.errors.count", unit: "count" },
        { event_id: "e3", agent: "other.agent", event: "unrelated.event" },
      ]);
      client.listAlerts.mockResolvedValue([]);
      client.listPolicies.mockResolvedValue([]);
      client.getEventLogs
        .mockResolvedValueOnce([{ occurred_at: recentAt, count: 10, value: 500, squares: 25100, min: 48, max: 55 }])
        .mockResolvedValueOnce([{ occurred_at: recentAt, count: 10, value: 2, squares: 6, min: 0, max: 1 }]);

      const result = await handlers.get("get_agent_summary")!({ agent: "openclaw.main" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.agent).toBe("openclaw.main");
      expect(parsed.event_count).toBe(2);
      expect(parsed.streams).toHaveLength(2);
      expect(parsed.streams[0].event_id).toBe("e1");
      expect(parsed.streams[1].event_id).toBe("e2");
      expect(parsed.streams[0].status).toBe("healthy");
      expect(parsed.overall_health).toBe("healthy");
      expect(parsed.status_summary).toEqual({ healthy: 2 });
      // Should not include the unrelated agent's event
      expect(parsed.streams.find((s: { event_id: string }) => s.event_id === "e3")).toBeUndefined();
    });

    it("marks streams as alert_active when triggered alerts exist", async () => {
      const recentAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      client.listEvents.mockResolvedValue([
        { event_id: "e1", agent: "openclaw.main", event: "task.errors.count" },
      ]);
      client.listAlerts.mockResolvedValue([
        { alert_id: "a1", event_id: "e1", severity: "error", status: "triggered", triggered_at: "2024-01-01T00:00:00Z" },
      ]);
      client.listPolicies.mockResolvedValue([]);
      client.getEventLogs.mockResolvedValue([{ occurred_at: recentAt, count: 5, value: 50, squares: 510, min: 9, max: 11 }]);

      const result = await handlers.get("get_agent_summary")!({ agent: "openclaw.main" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.streams[0].status).toBe("alert_active");
      expect(parsed.streams[0].active_alert_count).toBe(1);
      expect(parsed.overall_health).toBe("needs_attention");
    });

    it("returns empty streams message when no events match agent", async () => {
      client.listEvents.mockResolvedValue([
        { event_id: "e1", agent: "other.agent", event: "something" },
      ]);
      client.listAlerts.mockResolvedValue([]);
      client.listPolicies.mockResolvedValue([]);

      const result = await handlers.get("get_agent_summary")!({ agent: "openclaw.main" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.event_count).toBe(0);
      expect(parsed.streams).toHaveLength(0);
      expect(parsed.message).toContain("No events found");
    });

    it("returns isError on failure", async () => {
      client.listEvents.mockRejectedValue(new Error("unauthorized 401"));

      const result = await handlers.get("get_agent_summary")!({ agent: "openclaw.main" }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
