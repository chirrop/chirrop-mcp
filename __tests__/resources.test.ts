import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerResources } from "../src/resources/index.js";
import { createMockClient } from "./helpers.js";

describe("registerResources", () => {
  let server: { resource: ReturnType<typeof vi.fn> };
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = { resource: vi.fn() } as unknown as typeof server;
    client = createMockClient();
    registerResources(server as unknown as McpServer, client as unknown as Client);
  });

  it("registers 8 resources (4 static + 4 templates)", () => {
    expect(server.resource).toHaveBeenCalledTimes(8);
  });

  it("registers static resources with correct names", () => {
    const names = server.resource.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toContain("events");
    expect(names).toContain("triggered-alerts");
    expect(names).toContain("destinations");
    expect(names).toContain("events-summary");
  });

  it("registers resource templates", () => {
    const names = server.resource.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toContain("event-rollups");
    expect(names).toContain("alerts-by-status");
    expect(names).toContain("event-analytics");
    expect(names).toContain("agent-events");
  });

  describe("events resource handler", () => {
    it("returns event list as JSON", async () => {
      const events = [{ event_id: "e1", event: "test" }];
      client.listEvents.mockResolvedValue(events);

      const eventsCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "events")!;
      const handler = eventsCall[3] as (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
      const result = await handler(new URL("chirrop://events"));

      expect(JSON.parse(result.contents[0].text)).toEqual(events);
    });
  });

  describe("triggered-alerts resource handler", () => {
    it("calls listAlerts with triggered status", async () => {
      const alerts = [{ alert_id: "a1", status: "triggered" }];
      client.listAlerts.mockResolvedValue(alerts);

      const alertsCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "triggered-alerts")!;
      const handler = alertsCall[3] as (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
      await handler(new URL("chirrop://alerts/triggered"));

      expect(client.listAlerts).toHaveBeenCalledWith("triggered");
    });
  });

  describe("destinations resource handler", () => {
    it("returns destination list as JSON", async () => {
      const destinations = [{ destination_id: "d1", channel: "slack" }];
      client.listDestinations.mockResolvedValue(destinations);

      const destCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "destinations")!;
      const handler = destCall[3] as (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
      const result = await handler(new URL("chirrop://destinations"));

      expect(JSON.parse(result.contents[0].text)).toEqual(destinations);
    });
  });

  describe("destinations resource redaction", () => {
    it("redacts webhook URL paths and secret credentials", async () => {
      client.listDestinations.mockResolvedValue([
        { destination_id: "d1", channel: "slack", url: "https://hooks.slack.com/services/T/B/SECRET", credentials: { token: "SECRET" } },
      ]);
      const handler = server.resource.mock.calls.find((c: unknown[]) => c[0] === "destinations")![3] as (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;

      const { contents } = await handler(new URL("chirrop://destinations"));

      expect(contents[0].text).not.toContain("SECRET");
      expect(JSON.parse(contents[0].text)[0].url).toBe("https://hooks.slack.com/[redacted]");
    });
  });

  describe("events-summary resource handler", () => {
    it("returns events, triggered alert count, and alerted event IDs", async () => {
      const events = [{ event_id: "e1", event: "test" }, { event_id: "e2", event: "other" }];
      const alerts = [
        { alert_id: "a1", event_id: "e1", status: "triggered" },
        { alert_id: "a2", event_id: "e1", status: "triggered" },
      ];
      client.listEvents.mockResolvedValue(events);
      client.listAlerts.mockResolvedValue(alerts);

      const summaryCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "events-summary")!;
      const handler = summaryCall[3] as (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
      const result = await handler(new URL("chirrop://events/summary"));

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.events).toEqual(events);
      expect(parsed.triggered_alert_count).toBe(2);
      expect(parsed.events_with_active_alerts).toEqual(["e1"]);
      expect(parsed).toHaveProperty("snapshot_at");
    });

    it("calls listAlerts with triggered status", async () => {
      client.listEvents.mockResolvedValue([]);
      client.listAlerts.mockResolvedValue([]);

      const summaryCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "events-summary")!;
      const handler = summaryCall[3] as (uri: URL) => Promise<{ contents: Array<{ text: string }> }>;
      await handler(new URL("chirrop://events/summary"));

      expect(client.listAlerts).toHaveBeenCalledWith("triggered");
    });
  });

  describe("template parameter validation", () => {
    type TemplateHandler = (uri: URL, params: Record<string, string>) => Promise<unknown>;
    const handlerFor = (name: string) =>
      server.resource.mock.calls.find((c: unknown[]) => c[0] === name)![3] as TemplateHandler;
    const E = "11111111-1111-4111-8111-111111111111";

    it("rejects non-UUID event_ids before calling the SDK", async () => {
      await expect(handlerFor("event-rollups")(new URL("chirrop://x"), { event_id: "..", period: "hour" })).rejects.toThrow("Invalid event_id");
      await expect(handlerFor("event-analytics")(new URL("chirrop://x"), { event_id: "../destinations", period: "1h", previous: "previous_window" })).rejects.toThrow("Invalid event_id");
      expect(client.getEventLogs).not.toHaveBeenCalled();
      expect(client.getEventAnalytics).not.toHaveBeenCalled();
    });

    it("rejects unknown periods, statuses and comparison windows", async () => {
      await expect(handlerFor("event-rollups")(new URL("chirrop://x"), { event_id: E, period: "week" })).rejects.toThrow("Invalid period");
      await expect(handlerFor("alerts-by-status")(new URL("chirrop://x"), { status: "open" })).rejects.toThrow("Invalid status");
      await expect(handlerFor("event-analytics")(new URL("chirrop://x"), { event_id: E, period: "1h", previous: "last_year" })).rejects.toThrow("Invalid previous");
    });

    it("passes valid parameters through", async () => {
      await handlerFor("event-rollups")(new URL("chirrop://x"), { event_id: E, period: "minute" });
      expect(client.getEventLogs).toHaveBeenCalledWith(E, { period: "minute" });
    });

    it("reports malformed agent encoding instead of throwing URIError", async () => {
      await expect(handlerFor("agent-events")(new URL("chirrop://x"), { agent: "bad%E0%A4%A" })).rejects.toThrow("malformed URI encoding");
    });
  });

  describe("agent-events resource handler", () => {
    it("returns only events matching the agent", async () => {
      const events = [
        { event_id: "e1", agent: "openclaw.main", event: "task.duration_ms" },
        { event_id: "e2", agent: "openclaw.main", event: "task.errors.count" },
        { event_id: "e3", agent: "other.agent", event: "something.else" },
      ];
      client.listEvents.mockResolvedValue(events);

      const agentCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "agent-events")!;
      // ResourceTemplate handlers: (name, template, metadata, handler)
      const handler = agentCall[3] as (uri: URL, params: Record<string, string>) => Promise<{ contents: Array<{ text: string }> }>;
      const result = await handler(
        new URL("chirrop://agents/openclaw.main/events"),
        { agent: "openclaw.main" }
      );

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.agent).toBe("openclaw.main");
      expect(parsed.event_count).toBe(2);
      expect(parsed.events).toHaveLength(2);
      expect(parsed.events.map((e: { event_id: string }) => e.event_id)).toEqual(["e1", "e2"]);
    });

    it("returns empty events for unknown agent", async () => {
      client.listEvents.mockResolvedValue([
        { event_id: "e1", agent: "other.agent", event: "something" },
      ]);

      const agentCall = server.resource.mock.calls.find((c: unknown[]) => c[0] === "agent-events")!;
      const handler = agentCall[3] as (uri: URL, params: Record<string, string>) => Promise<{ contents: Array<{ text: string }> }>;
      const result = await handler(
        new URL("chirrop://agents/openclaw.main/events"),
        { agent: "openclaw.main" }
      );

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.event_count).toBe(0);
      expect(parsed.events).toHaveLength(0);
    });
  });
});
