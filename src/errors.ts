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
    if (
      status === 401 ||
      status === 403 ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("Unauthorized")
    ) {
      return `Authentication failed while trying to ${action}. Check that CHIRROP_API_KEY is valid.`;
    }
    if (status === 404 || msg.includes("404") || msg.includes("Not Found")) {
      return `Resource not found while trying to ${action}. ${hint ?? "Verify the ID exists."}`;
    }
    if (status === 429 || msg.includes("429")) {
      return `Rate limited while trying to ${action}. Wait and retry.`;
    }
    if (status === 400 || msg.includes("Bad Request")) {
      return `Invalid request while trying to ${action}: ${msg}`;
    }
    return `Failed to ${action}: ${msg}`;
  }
  return `Failed to ${action}: ${String(error)}`;
}
