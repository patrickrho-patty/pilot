import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import type {
  connectionProviderRegistrations,
  connectionWorkspaceBindings,
} from "@pilotai/db";
import { forbidden } from "../errors.js";
import { connectionDirectFetch } from "./connection-direct-tls.js";

/** Fixed integrations; registration is operator-owned, never supplied by a member. */
export const connectionRegistry = [
  {
    appId: "gmail",
    displayName: "Gmail",
    transport: "rest_api" as const,
    url: "https://gmail.googleapis.com",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    actions: ["read", "search", "write", "send"] as const,
  },
  {
    appId: "patty-kb",
    displayName: "Patty KB",
    transport: "mcp_remote" as const,
    url: "https://mcp.kb.patty.io/mcp",
    authorizationUrl:
      "https://login.patty.io/realms/internal/protocol/openid-connect/auth",
    tokenUrl:
      "https://login.patty.io/realms/internal/protocol/openid-connect/token",
    scopes: ["mcp:tools"],
    actions: ["read", "search"] as const,
  },
] as const;
/** Compose consent is requested only when workspace policy explicitly permits writing or sending. */
export function connectionScopes(
  app: (typeof connectionRegistry)[number],
  actions: readonly string[],
): string[] {
  return [
    ...app.scopes,
    ...(app.appId === "gmail" &&
    actions.some((a) => a === "write" || a === "send")
      ? ["https://www.googleapis.com/auth/gmail.compose"]
      : []),
  ];
}
/** A stored configuration may retain its original read-only scope after policy expands. */
export function connectionScopesValid(
  app: (typeof connectionRegistry)[number],
  scopes: unknown,
): scopes is string[] {
  return (
    Array.isArray(scopes) &&
    scopes.length > 0 &&
    new Set(scopes).size === scopes.length &&
    app.scopes.every((s) => scopes.includes(s)) &&
    scopes.every((s) => connectionScopes(app, app.actions).includes(s))
  );
}
export function connectionRegistrationReady(
  binding: typeof connectionWorkspaceBindings.$inferSelect,
  registration: typeof connectionProviderRegistrations.$inferSelect | undefined,
): boolean {
  return Boolean(
    registration?.qualified &&
      registration.clientId.trim() &&
      registration.clientId.length <= 256 &&
      registration.redirectUri ===
        `${new URL(binding.authorityUrl).origin}/api/connections/oauth/callback` &&
      (registration.appId !== "gmail" || !!registration.clientSecretId) &&
      (registration.appId !== "patty-kb" ||
        (registration.audience && registration.audience.length <= 2048)),
  );
}
/** Verify immutable KB identity using pinned issuer/JWKS, exact client/audience and scope. */
export async function verifyConnectionKbIdentity(
  token: string,
  registration: typeof connectionProviderRegistrations.$inferSelect,
  fetcher: typeof fetch = connectionDirectFetch,
) {
  const denied = () => forbidden("Provider identity denied");
  try {
    if (token.length > 32768) throw denied();
    const parts = token.split(".");
    if (parts.length !== 3) throw denied();
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const issuer = "https://login.patty.io/realms/internal";
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.crit ||
      header.jku ||
      header.x5u
    )
      throw denied();
    const response = await fetcher(`${issuer}/protocol/openid-connect/certs`, {
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw denied();
    const jwks = (await response.json()) as {
      keys?: Array<Record<string, unknown>>;
    };
    const keys = jwks.keys?.filter(
      (k) =>
        k.kid === header.kid &&
        k.kty === "RSA" &&
        (!k.use || k.use === "sig") &&
        (!k.alg || k.alg === "RS256"),
    );
    if (keys?.length !== 1) throw denied();
    const key = createPublicKey({ key: keys[0] as JsonWebKey, format: "jwk" });
    if (
      !verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        Buffer.from(parts[2], "base64url"),
      )
    )
      throw denied();
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== issuer ||
      claims.azp !== registration.clientId ||
      !registration.audience ||
      !aud.includes(registration.audience) ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 256 ||
      /\s/.test(claims.sub) ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= now ||
      (claims.nbf !== undefined &&
        (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      typeof claims.scope !== "string" ||
      !claims.scope.split(" ").includes("mcp:tools")
    )
      throw denied();
    return { issuer, subject: claims.sub as string };
  } catch {
    throw denied();
  }
}

/** Canonical provider configuration contains fixed URLs and operator registration references only. */
export function registeredConnectionConfiguration(
  app: (typeof connectionRegistry)[number],
  registration: typeof connectionProviderRegistrations.$inferSelect,
  scopes: readonly string[] = app.scopes,
) {
  const config = {
    url: app.url,
    oauth: {
      provider: app.appId,
      authorizationUrl: app.authorizationUrl,
      tokenUrl: app.tokenUrl,
      scopes: [...scopes],
      clientId: registration.clientId,
      clientRedirectUri: registration.redirectUri,
    },
  };
  const credentialSecretRefs = registration.clientSecretId
    ? [
        {
          secretId: registration.clientSecretId,
          versionSelector: "latest" as const,
          configPath: "oauth.client_secret",
          required: true,
          label: "Provider client",
        },
      ]
    : [];
  return { config, transportConfig: config, credentialSecretRefs };
}
