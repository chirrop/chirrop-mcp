import { describe, it, expect, vi, afterEach } from "vitest";
import { createChirrOpClient } from "../src/client.js";

describe("createChirrOpClient", () => {
  const original = process.env.CHIRROP_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.CHIRROP_API_KEY;
    else process.env.CHIRROP_API_KEY = original;
    vi.restoreAllMocks();
  });

  it("does not throw when the key is missing; calls fail with guidance", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.CHIRROP_API_KEY;
    const client = createChirrOpClient();
    expect(() => client.listEvents()).toThrow("CHIRROP_API_KEY is not set");
  });

  it.each(["${CHIRROP_API_KEY}", "not-a-chirrop-key"])(
    "does not crash on a malformed key (%s); calls fail with the reason",
    (key) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.CHIRROP_API_KEY = key;
      const client = createChirrOpClient();
      expect(() => client.listEvents()).toThrow(/CHIRROP_API_KEY is invalid: .*chp_/);
    }
  );

  it("returns a real client for a well-formed key", () => {
    process.env.CHIRROP_API_KEY = "chp_test_key";
    const client = createChirrOpClient();
    expect(typeof client.listEvents).toBe("function");
    expect(client).not.toHaveProperty("then");
  });
});
