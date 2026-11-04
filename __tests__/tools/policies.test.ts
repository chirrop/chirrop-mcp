import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@chirropjs/chirrop";
import { registerPolicyTools } from "../../src/tools/policies.js";
import { createMockClient, extractToolHandlers } from "../helpers.js";

describe("registerPolicyTools", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    server = { registerTool: vi.fn() } as unknown as McpServer;
    client = createMockClient();
    registerPolicyTools(server as McpServer, client as unknown as Client);
    handlers = extractToolHandlers(server as unknown as { registerTool: ReturnType<typeof vi.fn> });
  });

  it("registers 4 tools", () => {
    expect((server as unknown as { registerTool: ReturnType<typeof vi.fn> }).registerTool).toHaveBeenCalledTimes(4);
  });

  it("registers all expected tools", () => {
    expect(handlers.has("list_policies")).toBe(true);
    expect(handlers.has("get_policy")).toBe(true);
    expect(handlers.has("create_policy")).toBe(true);
    expect(handlers.has("update_policy")).toBe(true);
  });

  describe("list_policies", () => {
    it("returns JSON on success", async () => {
      const policies = [{ policy_id: "p1", title: "High errors" }];
      client.listPolicies.mockResolvedValue(policies);

      const result = await handlers.get("list_policies")!({}) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text)).toEqual(policies);
    });

    it("filters client-side by event_id", async () => {
      client.listPolicies.mockResolvedValue([
        { policy_id: "p1", event_id: "e1" },
        { policy_id: "p2", event_id: "e2" },
      ]);

      const result = await handlers.get("list_policies")!({ event_id: "e1" }) as { content: Array<{ text: string }> };

      expect(JSON.parse(result.content[0].text)).toEqual([{ policy_id: "p1", event_id: "e1" }]);
    });
  });

  describe("get_policy", () => {
    it("passes policy_id to SDK", async () => {
      const policy = { policy_id: "p1", title: "High errors" };
      client.getPolicy.mockResolvedValue(policy);

      await handlers.get("get_policy")!({ policy_id: "p1" });

      expect(client.getPolicy).toHaveBeenCalledWith("p1");
    });
  });

  describe("create_policy", () => {
    it("passes full payload to SDK", async () => {
      const payload = {
        event_id: "e1",
        title: "High errors",
        channel: "ops",
        period: "hour",
        aggregate: "sum",
        condition: "gt",
        threshold: 100,
        severity: "error",
        enabled: true,
      };
      client.createPolicy.mockResolvedValue({ policy_id: "p1", ...payload });

      await handlers.get("create_policy")!(payload);

      expect(client.createPolicy).toHaveBeenCalledWith(payload);
    });
  });

  describe("update_policy", () => {
    it("separates policy_id from payload", async () => {
      client.updatePolicy.mockResolvedValue({ policy_id: "p1", threshold: 200 });

      await handlers.get("update_policy")!({ policy_id: "p1", threshold: 200 });

      expect(client.updatePolicy).toHaveBeenCalledWith("p1", { threshold: 200 });
    });
  });
});
