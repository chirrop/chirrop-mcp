import { describe, it, expect } from "vitest";
import { formatError } from "../src/errors.js";

describe("formatError", () => {
  it("detects 401/403 authentication errors", () => {
    expect(formatError("list events", new Error("Request failed 401"))).toContain(
      "Authentication failed"
    );
    expect(formatError("list events", new Error("403 Forbidden"))).toContain(
      "Authentication failed"
    );
    expect(formatError("list events", new Error("Unauthorized"))).toContain(
      "Authentication failed"
    );
  });

  it("detects 404 not found errors", () => {
    expect(formatError("get event", new Error("404 Not Found"))).toContain(
      "not found"
    );
  });

  it("detects 429 rate limit errors", () => {
    expect(formatError("send logs", new Error("429 Too Many Requests"))).toContain(
      "Rate limited"
    );
  });

  it("prefers the HTTP status over numbers in the message", () => {
    const err = Object.assign(new Error("threshold 401 exceeded"), { response: { status: 500 } });
    expect(formatError("create policy", err)).toBe("Failed to create policy: threshold 401 exceeded");
    expect(formatError("get event", Object.assign(new Error("boom"), { status: 404 }))).toContain("not found");
  });

  it("only matches status codes as whole words in messages", () => {
    expect(formatError("send logs", new Error("value 4013 rejected"))).toBe("Failed to send logs: value 4013 rejected");
  });

  it("falls through to generic message for other errors", () => {
    const result = formatError("create policy", new Error("timeout"));
    expect(result).toBe("Failed to create policy: timeout");
  });

  it("handles non-Error values", () => {
    const result = formatError("update event", "something broke");
    expect(result).toBe("Failed to update event: something broke");
  });
});
