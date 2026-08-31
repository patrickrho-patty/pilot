import type { NostrEvent } from "./relay.js";

export function parseMentionTargets(event: NostrEvent): string[] {
  const out = new Set<string>();
  for (const [tag, value] of event.tags) {
    if (tag === "p" && typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)) {
      out.add(value.toLowerCase());
    }
  }
  return [...out];
}

export function threadRootOf(event: NostrEvent): string {
  for (const [tag, id, , marker] of event.tags) {
    if (tag === "e" && marker === "root" && typeof id === "string") return id;
  }
  return event.id;
}
