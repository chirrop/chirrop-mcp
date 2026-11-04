import { describe, it, expect } from "vitest";
import type { Client } from "@chirropjs/chirrop";
import { isUuid, resolveEventId, resolveEventRefs } from "../src/refs.js";
import { createMockClient } from "./helpers.js";
import { formatError } from "../src/errors.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function clientWithEvents(events: Array<{ event_id: string; event: string; agent?: string }>) {
  const client = createMockClient();
  client.listEvents.mockResolvedValue(events);
  return client as unknown as Client;
}

describe("isUuid", () => {
  it("accepts UUIDs and rejects names", () => {
    expect(isUuid(UUID_A)).toBe(true);
    expect(isUuid("tool.errors.count")).toBe(false);
  });
});

describe("resolveEventId", () => {
  it("returns event_id directly without calling the API", async () => {
    const client = createMockClient();
    const id = await resolveEventId(client as unknown as Client, { event_id: UUID_A });
    expect(id).toBe(UUID_A);
    expect(client.listEvents).not.toHaveBeenCalled();
  });

  it("resolves a unique event name", async () => {
    const client = clientWithEvents([{ event_id: UUID_A, event: "tool.errors.count" }]);
    expect(await resolveEventId(client, { event: "tool.errors.count" })).toBe(UUID_A);
  });

  it("uses agent to disambiguate duplicate names", async () => {
    const client = clientWithEvents([
      { event_id: UUID_A, event: "tool.errors.count", agent: "openclaw.main" },
      { event_id: UUID_B, event: "tool.errors.count", agent: "openclaw.scheduler" },
    ]);
    expect(
      await resolveEventId(client, { event: "tool.errors.count", agent: "openclaw.scheduler" })
    ).toBe(UUID_B);
  });

  it("throws with the ambiguous agents listed when no agent is given", async () => {
    const client = clientWithEvents([
      { event_id: UUID_A, event: "tool.errors.count", agent: "openclaw.main" },
      { event_id: UUID_B, event: "tool.errors.count", agent: "openclaw.scheduler" },
    ]);
    await expect(resolveEventId(client, { event: "tool.errors.count" })).rejects.toThrow(
      /multiple agents/
    );
  });

  it("throws with close matches when the name is unknown", async () => {
    const client = clientWithEvents([{ event_id: UUID_A, event: "tool.errors.count" }]);
    await expect(resolveEventId(client, { event: "errors" })).rejects.toThrow(
      /tool\.errors\.count/
    );
  });

  it("throws when neither event_id nor event is provided", async () => {
    const client = createMockClient();
    await expect(
      resolveEventId(client as unknown as Client, {})
    ).rejects.toThrow(/event_id/);
  });
});

describe("resolveEventRefs", () => {
  it("passes UUIDs through without calling the API", async () => {
    const client = createMockClient();
    const ids = await resolveEventRefs(client as unknown as Client, [UUID_A, UUID_B]);
    expect(ids).toEqual([UUID_A, UUID_B]);
    expect(client.listEvents).not.toHaveBeenCalled();
  });

  it("resolves names mixed with UUIDs", async () => {
    const client = clientWithEvents([{ event_id: UUID_B, event: "task.duration_ms" }]);
    const ids = await resolveEventRefs(client, [UUID_A, "task.duration_ms"]);
    expect(ids).toEqual([UUID_A, UUID_B]);
  });

  it("throws for unknown names", async () => {
    const client = clientWithEvents([]);
    await expect(resolveEventRefs(client, ["nope"])).rejects.toThrow(/list_events/);
  });
});

describe("formatError hints", () => {
  it("appends the hint on not-found errors", () => {
    expect(
      formatError("get event", new Error("404 Not Found"), "Call list_events to see valid event IDs.")
    ).toContain("Call list_events");
  });

  it("uses the default hint when none is given", () => {
    expect(formatError("get event", new Error("404 Not Found"))).toContain("Verify the ID exists.");
  });

  it("reads status codes from error properties", () => {
    const err = Object.assign(new Error("request failed"), { status: 429 });
    expect(formatError("send logs", err)).toContain("Rate limited");
  });
});
