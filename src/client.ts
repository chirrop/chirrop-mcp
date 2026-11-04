import { createClient, Client } from "@chirropjs/chirrop";

const MISSING_KEY_MESSAGE =
  'CHIRROP_API_KEY is not set. Add it to the MCP server\'s environment — e.g. the "env" block of the server entry in your MCP client config, or your shell profile — then restart the server.';

export function createChirrOpClient(): Client {
  const key = process.env.CHIRROP_API_KEY;
  if (!key) {
    // Start the server anyway so the error surfaces in tool results, where the
    // user can see it, instead of as an opaque connection failure.
    console.error(MISSING_KEY_MESSAGE);
    return new Proxy({} as Client, {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return () => {
          throw new Error(MISSING_KEY_MESSAGE);
        };
      },
    });
  }

  return createClient({ key });
}
