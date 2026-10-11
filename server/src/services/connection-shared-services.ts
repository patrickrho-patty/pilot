import { and, eq, isNull, notInArray } from "drizzle-orm";
import { companySecrets, companySecretVersions, type Db } from "@pilotai/db";
import type { ConnectionWorkspaceBinding } from "@pilotai/shared";

/** Operator-owned shared services. Admin approval never exposes these credentials to members. */
export const sharedConnectionApps = [
  {
    appId: "web-search",
    displayName: "Web Search (Serper)",
    actions: ["search"] as const,
    secretKey: "crew_serper_api_key",
  },
] as const;

/** Canonical company credential metadata only; no credential material or environment fallback. */
export async function sharedConnectionCredential(
  db: Db,
  binding: ConnectionWorkspaceBinding,
  appId: string,
) {
  const app = sharedConnectionApps.find((entry) => entry.appId === appId);
  if (!app) return undefined;
  const [row] = await db
    .select({ secret: companySecrets })
    .from(companySecrets)
    .innerJoin(
      companySecretVersions,
      and(
        eq(companySecretVersions.secretId, companySecrets.id),
        eq(companySecretVersions.version, companySecrets.latestVersion),
        notInArray(companySecretVersions.status, ["disabled", "destroyed"]),
        isNull(companySecretVersions.revokedAt),
      ),
    )
    .where(
      and(
        eq(companySecrets.companyId, binding.companyId),
        eq(companySecrets.key, app.secretKey),
        eq(companySecrets.scope, "company"),
        eq(companySecrets.provider, "local_encrypted"),
        eq(companySecrets.status, "active"),
        isNull(companySecrets.deletedAt),
      ),
    )
    .limit(1);
  return row?.secret;
}
