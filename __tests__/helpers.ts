import { vi } from "vitest";
import type { Client } from "@chirropjs/chirrop";

/**
 * Creates a fully-mocked Client instance for testing.
 * Every public SDK method is replaced with a vi.fn().
 */
export function createMockClient(): {
  [K in keyof Client]: Client[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : Client[K];
} {
  return {
    log: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    listEvents: vi.fn().mockResolvedValue([]),
    createEvent: vi.fn().mockResolvedValue({}),
    getEvent: vi.fn().mockResolvedValue({}),
    updateEvent: vi.fn().mockResolvedValue({}),
    listPolicies: vi.fn().mockResolvedValue([]),
    getPolicy: vi.fn().mockResolvedValue({}),
    createPolicy: vi.fn().mockResolvedValue({}),
    updatePolicy: vi.fn().mockResolvedValue({}),
    listAlerts: vi.fn().mockResolvedValue([]),
    getAlert: vi.fn().mockResolvedValue({}),
    getAlertDeliveries: vi.fn().mockResolvedValue([]),
    acknowledgeAlert: vi.fn().mockResolvedValue({}),
    resolveAlert: vi.fn().mockResolvedValue({}),
    archiveAlert: vi.fn().mockResolvedValue({}),
    listDestinations: vi.fn().mockResolvedValue([]),
    createDestination: vi.fn().mockResolvedValue({}),
    getDestination: vi.fn().mockResolvedValue({}),
    updateDestination: vi.fn().mockResolvedValue({}),
    testDestination: vi.fn().mockResolvedValue({}),
    getEventLogs: vi.fn().mockResolvedValue([]),
    getEventAnalytics: vi.fn().mockResolvedValue({}),
  } as unknown as ReturnType<typeof createMockClient>;
}

/**
 * Extracts registered tool handlers from an McpServer mock.
 * Returns a map of tool name → handler function.
 */
export function extractToolHandlers(
  serverMock: { registerTool: ReturnType<typeof vi.fn> }
): Map<string, (...args: unknown[]) => unknown> {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  for (const call of serverMock.registerTool.mock.calls) {
    // registerTool(name, config, handler)
    const [name, , handler] = call;
    handlers.set(name, handler);
  }
  return handlers;
}
