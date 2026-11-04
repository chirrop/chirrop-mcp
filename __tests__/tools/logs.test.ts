import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerLogTools } from "../../src/tools/logs.js";
import { createMockClient, extractToolHandlers } from "../helpers.js";

describe("registerLogTools", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    client = createMockClient();
    registerLogTools(server as McpServer, client as unknown as Client);
    handlers = extractToolHandlers(server as unknown as { registerTool: ReturnType<typeof vi.fn> });
  });

  it("registers 1 tool", () => {
    expect((server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool).toHaveBeenCalledTimes(1);
  });

  it("registers send_logs", () => {
    expect(handlers.has("send_logs")).toBe(true);
  });

  describe("send_logs", () => {
    it("sends logs and flushes on success", async () => {
      const handler = handlers.get("send_logs")!;
      const logs = [
        { event: "test.count", value: 1 },
        { event: "test.count", value: 2 },
      ];

      const result = await handler({ logs }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(client.log).toHaveBeenCalledTimes(2);
      expect(client.flush).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain("2 log(s) successfully");
      expect(result.isError).toBeUndefined();

      const structured = JSON.parse(result.content[1].text);
      expect(structured.sent).toBe(2);
      expect(structured.failed).toBe(0);
      expect(structured.results).toEqual([
        { index: 0, log_id: expect.any(String), event: "test.count", ok: true },
        { index: 1, log_id: expect.any(String), event: "test.count", ok: true },
      ]);
    });

    it("assigns log_ids up front, keeps caller-supplied ones, and returns them for retry", async () => {
      const handler = handlers.get("send_logs")!;
      client.flush.mockRejectedValueOnce(new Error("socket hang up"));
      const supplied = "0b6f5a3e-4c1d-4f7a-9e2b-8a1c2d3e4f50";

      const result = await handler({
        logs: [{ event: "a.count", value: 1, log_id: supplied }, { event: "b.count", value: 2 }],
      }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      const { results } = JSON.parse(result.content[1].text);
      expect(results[0].log_id).toBe(supplied);
      expect(results[1].log_id).toMatch(/^[0-9a-f-]{36}$/);
      // the IDs reported are the ones actually sent to the SDK
      expect(client.log.mock.calls.map((c: unknown[]) => (c[0] as { log_id: string }).log_id))
        .toEqual([supplied, results[1].log_id]);
    });

    it("reports partial failures", async () => {
      const handler = handlers.get("send_logs")!;
      client.log
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("bad event"));

      const logs = [
        { event: "good.event", value: 1 },
        { event: "bad.event", value: 2 },
      ];

      const result = await handler({ logs }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.content[0].text).toContain("1/2");
      expect(result.content[0].text).toContain("bad event");

      const structured = JSON.parse(result.content[1].text);
      expect(structured.sent).toBe(1);
      expect(structured.failed).toBe(1);
      expect(structured.results[1]).toEqual({ index: 1, log_id: expect.any(String), event: "bad.event", ok: false, error: "bad event" });
    });

    it("returns isError when all logs fail", async () => {
      const handler = handlers.get("send_logs")!;
      client.log.mockRejectedValue(new Error("all bad"));

      const result = await handler({ logs: [{ event: "e", value: 1 }] }) as { content: Array<{ text: string }>; isError?: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("failed");
    });
  });
});
