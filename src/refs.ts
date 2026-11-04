import { Client, Event } from "@chirropjs/chirrop";
import { z } from "zod";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Shared input fields for tools that reference an event. Callers pass either
 * event_id, or event (name) with an optional agent to disambiguate.
 */
export const eventRefFields = {
  event_id: z
    .string()
    .uuid("Must be a valid UUID.")
    .optional()
    .describe("The event UUID. Provide this OR the event name."),
  event: z
    .string()
    .optional()
    .describe(
      "Event name as an alternative to event_id, e.g. 'tool.errors.count'. Combine with agent if the same name exists under multiple agents."
    ),
  agent: z
    .string()
    .optional()
    .describe("Agent identity to scope the event name lookup, e.g. 'openclaw.main'."),
};

export interface EventRef {
  event_id?: string;
  event?: string;
  agent?: string;
}

function describeEvent(e: Event): string {
  return e.agent ? `${e.agent} / ${e.event}` : e.event;
}

export async function resolveEventId(client: Client, ref: EventRef): Promise<string> {
  if (ref.event_id) return ref.event_id;
  if (!ref.event) {
    throw new Error(
      "Provide either event_id, or event (the event name) with an optional agent."
    );
  }
  const events = (await client.listEvents()) as unknown as Event[];
  let matches = events.filter((e) => e.event === ref.event);
  if (ref.agent) matches = matches.filter((e) => e.agent === ref.agent);
  if (matches.length === 1) return matches[0]!.event_id;
  if (matches.length === 0) {
    const needle = ref.event.toLowerCase();
    const near = events
      .filter((e) => e.event.toLowerCase().includes(needle))
      .slice(0, 5)
      .map(describeEvent);
    throw new Error(
      `No event named "${ref.event}"${ref.agent ? ` for agent "${ref.agent}"` : ""}.` +
        (near.length > 0
          ? ` Close matches: ${near.join(", ")}.`
          : " Call list_events to see available events.")
    );
  }
  const options = matches
    .map((e) => `${describeEvent(e)} (${e.event_id})`)
    .join(", ");
  throw new Error(
    `Event name "${ref.event}" exists under multiple agents: ${options}. Add the agent parameter or use event_id.`
  );
}

/**
 * Resolve a list of refs where each entry is either an event UUID or an exact
 * event name. Names that match multiple agents must be passed as UUIDs.
 */
export async function resolveEventRefs(client: Client, refs: string[]): Promise<string[]> {
  if (refs.every(isUuid)) return refs;
  const events = (await client.listEvents()) as unknown as Event[];
  return refs.map((ref) => {
    if (isUuid(ref)) return ref;
    const matches = events.filter((e) => e.event === ref);
    if (matches.length === 1) return matches[0]!.event_id;
    if (matches.length === 0) {
      throw new Error(`No event named "${ref}". Call list_events to see available events.`);
    }
    const options = matches.map((e) => `${describeEvent(e)} (${e.event_id})`).join(", ");
    throw new Error(
      `Event name "${ref}" exists under multiple agents: ${options}. Use its UUID in event_ids.`
    );
  });
}
