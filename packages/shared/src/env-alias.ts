const LEGACY_PREFIX = "PAPERCLIP_";
const TARGET_PREFIX = "PILOT_";

/**
 * Boot-time compat shim for the Paperclip→Pilot env rename. Copies every set
 * PAPERCLIP_X onto unset PILOT_X (never the reverse, never overwriting).
 * Call once at process entry before any config read; returns the mapped names
 * so callers can log that the alias window is active. Remove together with the
 * PAPERCLIP_* deprecation in a future major.
 */
export function applyLegacyPaperclipEnvAliases(): string[] {
  const mapped: string[] = [];
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(LEGACY_PREFIX) || key === LEGACY_PREFIX) continue;
    const target = TARGET_PREFIX + key.slice(LEGACY_PREFIX.length);
    if (process.env[target] === undefined) {
      process.env[target] = process.env[key];
      mapped.push(target);
    }
  }
  return mapped;
}
