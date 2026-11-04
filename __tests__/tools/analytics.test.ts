import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerAnalyticsTools } from "../../src/tools/analytics.js";
import { createMockClient, extractToolHandlers } from "../helpers.js";

describe("registerAnalyticsTools", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    client = createMockClient();
    registerAnalyticsTools(server as McpServer, client as unknown as Client);
    handlers = extractToolHandlers(server as unknown as { registerTool: ReturnType<typeof vi.fn> });
  });

  it("registers 3 tools", () => {
    expect((server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool).toHaveBeenCalledTimes(3);
  });

  it("registers all expected tools", () => {
    expect(handlers.has("get_event_analytics")).toBe(true);
    expect(handlers.has("detect_anomalies")).toBe(true);
    expect(handlers.has("compare_events")).toBe(true);
  });

  describe("get_event_analytics", () => {
    it("passes correct query to SDK and includes _interpretation", async () => {
      const analytics = {
        event_id: "e1",
        view: "window" as const,
        period: "1h" as const,
        previous: "previous_window" as const,
        data: {
          current_value: 134, previous_value: 100, value_delta: 34, value_pct_change: 34,
          current_count: 112, previous_count: 100, count_delta: 12, count_pct_change: 12,
          current_mean: 1.196, previous_mean: 1.0, mean_delta: 0.196, mean_pct_change: 8,
          current_stddev: 2.0, previous_stddev: 1.0,
        },
      };
      client.getEventAnalytics.mockResolvedValue(analytics);

      const result = await handlers.get("get_event_analytics")!({
        event_id: "e1",
        period: "1h",
        previous: "previous_window",
      }) as { content: Array<{ text: string }> };

      expect(client.getEventAnalytics).toHaveBeenCalledWith("e1", {
        view: "window",
        period: "1h",
        previous: "previous_window",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.event_id).toBe("e1");
      expect(parsed).toHaveProperty("_interpretation");
      expect(parsed._interpretation).not.toBeNull();
      expect(parsed._interpretation.value_signal).toBe("significant_increase");
      expect(parsed._interpretation.count_signal).toBe("moderate_increase");
      expect(parsed._interpretation.mean_signal).toBe("moderate_increase");
      expect(parsed._interpretation.volatility_change).toBe("much_higher_variance");
      expect(typeof parsed._interpretation.summary).toBe("string");
    });

    it("returns null interpretation when data is null (no events in period)", async () => {
      const analytics = { event_id: "e1", view: "window" as const, period: "1h" as const, previous: "previous_window" as const, data: null };
      client.getEventAnalytics.mockResolvedValue(analytics);

      const result = await handlers.get("get_event_analytics")!({
        event_id: "e1",
        period: "1h",
        previous: "previous_window",
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed._interpretation).toBeNull();
    });

    it("returns isError on failure", async () => {
      client.getEventAnalytics.mockRejectedValue(new Error("server error"));

      const result = await handlers.get("get_event_analytics")!({
        event_id: "e1",
        period: "1d",
        previous: "previous_1d",
      }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed");
    });
  });

  describe("detect_anomalies", () => {
    it("returns anomalies for clear outlier buckets", async () => {
      const rollups = Array.from({ length: 10 }, (_, i) => ({
        count: 10,
        value: 100,
        squares: 1000,
        occurred_at: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        min: 9,
        max: 11,
      }));
      // Add a clear spike
      rollups.push({
        count: 10,
        value: 10000,
        squares: 10000000,
        occurred_at: "2024-01-01T10:00:00Z",
        min: 990,
        max: 1010,
      });
      client.getEventLogs.mockResolvedValue(rollups);

      const result = await handlers.get("detect_anomalies")!({
        event_id: "e1",
        period: "hour",
        threshold_sigma: 2.0,
      }) as { content: Array<{ text: string }> };

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.event_id).toBe("e1");
      expect(parsed.has_sufficient_data).toBe(true);
      expect(parsed.anomaly_count).toBeGreaterThan(0);
      expect(parsed.anomalies[0].direction).toBe("spike");
      expect(parsed.anomalies[0].deviation_sigma).toBeGreaterThan(2.0);
    });

    it("flags has_sufficient_data as false with fewer than 10 buckets", async () => {
      client.getEventLogs.mockResolvedValue([
        { count: 10, value: 100, squares: 1000, occurred_at: "2024-01-01T00:00:00Z" },
        { count: 10, value: 200, squares: 4000, occurred_at: "2024-01-01T01:00:00Z" },
      ]);

      const result = await handlers.get("detect_anomalies")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.has_sufficient_data).toBe(false);
    });

    it("returns empty anomalies for uniform data", async () => {
      const rollups = Array.from({ length: 20 }, (_, i) => ({
        count: 10,
        value: 100,
        squares: 1000,
        occurred_at: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
      }));
      client.getEventLogs.mockResolvedValue(rollups);

      const result = await handlers.get("detect_anomalies")!({ event_id: "e1" }) as { content: Array<{ text: string }> };
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.anomaly_count).toBe(0);
      expect(parsed.anomalies).toHaveLength(0);
    });

    it("returns isError on failure", async () => {
      client.getEventLogs.mockRejectedValue(new Error("not found 404"));

      const result = await handlers.get("detect_anomalies")!({ event_id: "missing" }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
    });
  });

  describe("compare_events", () => {
    it("fetches rollups for all event_ids concurrently and returns side-by-side stats", async () => {
      const makeRollups = (mean: number) =>
        Array.from({ length: 5 }, (_, i) => ({
          count: 10,
          value: mean * 10,
          squares: mean * mean * 10 * 1.1,
          occurred_at: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
          min: mean - 1,
          max: mean + 1,
        }));

      // non-UUID entries are treated as event names and resolved via listEvents
      client.listEvents.mockResolvedValue([
        { event_id: "e1", event: "e1" },
        { event_id: "e2", event: "e2" },
      ]);
      client.getEventLogs
        .mockResolvedValueOnce(makeRollups(10))
        .mockResolvedValueOnce(makeRollups(50));

      const result = await handlers.get("compare_events")!({
        event_ids: ["e1", "e2"],
        period: "hour",
        limit: 5,
      }) as { content: Array<{ text: string }> };

      expect(client.getEventLogs).toHaveBeenCalledTimes(2);
      expect(client.getEventLogs).toHaveBeenCalledWith("e1", { period: "hour", limit: 5 });
      expect(client.getEventLogs).toHaveBeenCalledWith("e2", { period: "hour", limit: 5 });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.streams).toHaveLength(2);
      expect(parsed.streams[0].event_id).toBe("e1");
      expect(parsed.streams[1].event_id).toBe("e2");
      expect(parsed.streams[0]).toHaveProperty("mean");
      expect(parsed.streams[0]).toHaveProperty("stddev");
      expect(parsed.streams[0]).toHaveProperty("trend_direction");
      expect(parsed.streams[0]).toHaveProperty("anomaly_count");
      expect(parsed.streams[1].mean).toBeGreaterThan(parsed.streams[0].mean);
    });

    it("returns isError on failure", async () => {
      client.getEventLogs.mockRejectedValue(new Error("unauthorized 401"));

      const result = await handlers.get("compare_events")!({
        event_ids: ["e1", "e2"],
      }) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
    });
  });
});
