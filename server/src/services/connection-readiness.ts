import { sql } from "drizzle-orm";
import { connectionGrants, toolConnections } from "@pilotai/db";

/** Project only a current consent's durable refresh claim; never replay an abandoned claim. */
export function connectionNeedsReauthorization(
  connection: typeof toolConnections.$inferSelect,
  consent: typeof connectionGrants.$inferSelect,
  now = Date.now(),
): boolean {
  const config = connection.config.oauth as Record<string, unknown> | undefined;
  const claim = config?.externalRefresh as Record<string, unknown> | undefined;
  return (
    typeof claim?.id === "string" &&
    claim.consentId === consent.id &&
    claim.generation === consent.consentGeneration &&
    (claim.outcome === "reconnect-required" ||
      typeof claim.expiresAt !== "number" ||
      claim.expiresAt <= now)
  );
}
/** Same projection in SQL, applied before effective-grant inventory bounds. */
export function connectionCredentialsUsable() {
  const claim = sql`${toolConnections.config}->'oauth'->'externalRefresh'`;
  return sql`NOT COALESCE((
    jsonb_typeof(${claim}->'id') = 'string'
    AND ${claim}->>'consentId' = ${connectionGrants.id}::text
    AND ${claim}->'generation' = to_jsonb(${connectionGrants.consentGeneration})
    AND (${claim}->>'outcome' = 'reconnect-required' OR CASE
      WHEN jsonb_typeof(${claim}->'expiresAt') = 'number'
      THEN (${claim}->>'expiresAt')::numeric <= extract(epoch FROM clock_timestamp()) * 1000
      ELSE true END)
  ), false)`;
}
