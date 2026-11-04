import { createClient, Client } from "@chirropjs/chirrop";

const MISSING_KEY_MESSAGE =
  'CHIRROP_API_KEY is not set. Add it to the MCP server\'s environment — e.g. the "env" block of the server entry in your MCP client config, or your shell profile — then restart the server.';

/**
 * A stand-in client whose every method throws, so configuration errors surface
 * in tool results, where the user can see them, instead of as an opaque
 * connection failure.
 */
function failingClient(message: string): Client {
  console.error(message);
  return new Proxy({} as Client, {
    get(_target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return () => {
        throw new Error(message);
      };
    },
  });
}

export function createChirrOpClient(): Client {
  const key = process.env.CHIRROP_API_KEY;
  if (!key) return failingClient(MISSING_KEY_MESSAGE);

  try {
    return createClient({ key });
  } catch (error) {
    // The SDK rejects malformed keys at construction (e.g. not starting with
    // "chp_", or an unexpanded "${CHIRROP_API_KEY}" placeholder); without this
    // the process exits before the MCP handshake.
    const reason = error instanceof Error ? error.message : String(error);
    return failingClient(
      `CHIRROP_API_KEY is invalid: ${reason}. Check the value in the MCP server's environment, then restart the server.`
    );
  }
}
