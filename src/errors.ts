function statusOf(error: unknown): number | undefined {
  const e = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  for (const candidate of [e?.status, e?.statusCode, e?.response?.status]) {
    if (typeof candidate === "number") return candidate;
  }
  return undefined;
}

/**
 * Format an error into an actionable message. The optional hint tells the
 * model how to recover (e.g. which list tool returns valid IDs) and is
 * appended to not-found errors.
 */
export function formatError(action: string, error: unknown, hint?: string): string {
  if (error instanceof Error) {
    const msg = error.message;
    const status = statusOf(error);
    // Prefer the HTTP status; only fall back to the message when there is none,
    // matching codes as whole words so e.g. "value 4013" isn't read as a 401.
    const is = (code: number, ...phrases: string[]) =>
      status !== undefined
        ? status === code
        : new RegExp(`\\b${code}\\b`).test(msg) || phrases.some((p) => msg.includes(p));
    if (is(401, "Unauthorized") || is(403, "Forbidden")) {
      return `Authentication failed while trying to ${action}. Check that CHIRROP_API_KEY is valid.`;
    }
    if (is(404, "Not Found")) {
      return `Resource not found while trying to ${action}. ${hint ?? "Verify the ID exists."}`;
    }
    if (is(429, "Too Many Requests")) {
      return `Rate limited while trying to ${action}. Wait and retry.`;
    }
    if (is(400, "Bad Request")) {
      return `Invalid request while trying to ${action}: ${msg}`;
    }
    return `Failed to ${action}: ${msg}`;
  }
  return `Failed to ${action}: ${String(error)}`;
}
