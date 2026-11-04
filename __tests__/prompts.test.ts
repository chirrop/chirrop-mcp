import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "../src/prompts/index.js";

describe("registerPrompts", () => {
  let server: { prompt: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    server = { prompt: vi.fn() } as unknown as typeof server;
    registerPrompts(server as unknown as McpServer);
  });

  it("registers 5 prompts", () => {
    expect(server.prompt).toHaveBeenCalledTimes(5);
  });

  it("registers all expected prompts", () => {
    const names = server.prompt.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toContain("setup-monitoring");
    expect(names).toContain("triage-alert");
    expect(names).toContain("compare-analytics");
    expect(names).toContain("investigate-stream");
    expect(names).toContain("bulk-ingest-review");
  });

  describe("setup-monitoring prompt handler", () => {
    it("interpolates event_name into the message", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "setup-monitoring")!;
      const handler = call[3] as (args: Record<string, string>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({ event_name: "tool.errors.count", agent: "myapp", unit: "count" });

      const text = result.messages[0].content.text;
      expect(text).toContain("tool.errors.count");
      expect(text).toContain("myapp");
      expect(text).toContain("count");
      expect(text).toContain("create_event");
      expect(text).toContain("create_policy");
      expect(text).toContain("create_destination");
      expect(text).toContain("test_destination");
    });

    it("works without optional args", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "setup-monitoring")!;
      const handler = call[3] as (args: Record<string, string | undefined>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({ event_name: "basic.event" });

      expect(result.messages[0].content.text).toContain("basic.event");
    });
  });

  describe("triage-alert prompt handler", () => {
    it("interpolates alert_id into the message", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "triage-alert")!;
      const handler = call[3] as (args: Record<string, string>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({ alert_id: "abc-123" });

      const text = result.messages[0].content.text;
      expect(text).toContain("abc-123");
      expect(text).toContain("get_alert");
      expect(text).toContain("get_event_rollups");
      expect(text).toContain("get_event_analytics");
      expect(text).toContain("acknowledge_alert");
      expect(text).toContain("resolve_alert");
      expect(text).toContain("archive_alert");
    });
  });

  describe("compare-analytics prompt handler", () => {
    it("interpolates all args into the message", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "compare-analytics")!;
      const handler = call[3] as (args: Record<string, string>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({ event_id: "e1", period: "1h", previous: "previous_window" });

      const text = result.messages[0].content.text;
      expect(text).toContain("e1");
      expect(text).toContain("1h");
      expect(text).toContain("previous_window");
      expect(text).toContain("get_event_analytics");
    });
  });

  describe("investigate-stream prompt handler", () => {
    it("interpolates event_id and period into the message", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "investigate-stream")!;
      const handler = call[3] as (args: Record<string, string>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({ event_id: "e1", period: "minute" });

      const text = result.messages[0].content.text;
      expect(text).toContain("e1");
      expect(text).toContain("minute");
      expect(text).toContain("get_stream_health");
      expect(text).toContain("detect_anomalies");
      expect(text).toContain("get_event_analytics");
      expect(text).toContain("list_policies");
    });

    it("defaults period to hour when not provided", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "investigate-stream")!;
      const handler = call[3] as (args: Record<string, string | undefined>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({ event_id: "e1" });

      expect(result.messages[0].content.text).toContain("hour");
    });
  });

  describe("bulk-ingest-review prompt handler", () => {
    it("returns a message referencing all key tools", () => {
      const call = server.prompt.mock.calls.find((c: unknown[]) => c[0] === "bulk-ingest-review")!;
      const handler = call[3] as (args: Record<string, never>) => { messages: Array<{ content: { text: string } }> };
      const result = handler({});

      const text = result.messages[0].content.text;
      expect(text).toContain("list_events");
      expect(text).toContain("chirrop://events/summary");
      expect(text).toContain("compare_events");
      expect(text).toContain("SILENT");
      expect(text).toContain("markdown table");
    });
  });
});
