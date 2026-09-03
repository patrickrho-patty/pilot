import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth, type Auth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, keycloak } from "better-auth/plugins/generic-oauth";
import { toNodeHandler } from "better-auth/node";
import type { Db } from "@pilotai/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  companies,
  companyMemberships,
} from "@pilotai/db";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { AuthKeycloakSettings } from "../config.js";
import { accessService } from "../services/access.js";
import { resolvePilotInstanceId } from "../home-paths.js";
import {
  workspaceLoginHandoffPlugin,
  type WorkspaceHandoffExpectedIdentity,
} from "./workspace-login-handoff-plugin.js";
import {
  normalizeWorkspaceHandoffOrigin,
  resolveWorkspaceHandoffLocalCompanyId,
  resolveWorkspaceHandoffLocalKey,
  resolveWorkspaceHandoffLocalWorkspaceId,
} from "./workspace-login-handoff.js";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthGetSessionApi = {
  getSession?: (input: { headers: Headers }) => Promise<unknown>;
};

type BetterAuthHandlerTarget = Extract<Parameters<typeof toNodeHandler>[0], { handler: Auth["handler"] }>;

type BetterAuthSessionResolver = {
  api?: BetterAuthGetSessionApi;
};

type BetterAuthInstance = BetterAuthHandlerTarget & BetterAuthSessionResolver;

const AUTH_COOKIE_PREFIX_FALLBACK = "default";
const AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE = /[^a-zA-Z0-9_-]+/g;

export function deriveAuthCookiePrefix(instanceId = resolvePilotInstanceId()): string {
  const scopedInstanceId = instanceId
    .trim()
    .replace(AUTH_COOKIE_PREFIX_INVALID_SEGMENTS_RE, "-")
    .replace(/^-+|-+$/g, "") || AUTH_COOKIE_PREFIX_FALLBACK;
  return `pilot-${scopedInstanceId}`;
}

export function buildBetterAuthAdvancedOptions(input: { disableSecureCookies: boolean }) {
  return {
    cookiePrefix: deriveAuthCookiePrefix(),
    ...(input.disableSecureCookies ? { useSecureCookies: false } : {}),
  };
}

/**
 * Email+password sign-in is disabled entirely on SSO-only instances: when a
 * Keycloak realm is configured, board identity comes from the realm and there
 * are no local passwords to sign into.
 */
export function boardEmailPasswordEnabled(config: { authKeycloak: unknown }): boolean {
  return !config.authKeycloak;
}

export function shouldEnableAuthRateLimit(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  override?: string | undefined;
}): boolean {
  const override = input.override?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  return input.deploymentMode === "authenticated";
}

export function buildBetterAuthRateLimitOptions(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  override?: string | undefined;
}) {
  return {
    enabled: shouldEnableAuthRateLimit(input),
  };
}

export function shouldDisableSecureAuthCookies(input: {
  deploymentMode: Config["deploymentMode"];
  deploymentExposure?: Config["deploymentExposure"];
  authBaseUrlMode: Config["authBaseUrlMode"];
  authPublicBaseUrl: string | undefined;
  publicUrl?: string | undefined;
}): boolean {
  const publicUrl = (
    input.publicUrl?.trim() ||
    (input.authBaseUrlMode === "explicit" ? input.authPublicBaseUrl?.trim() : "")
  );
  if (publicUrl) return publicUrl.startsWith("http://");

  return (
    input.deploymentMode === "authenticated" &&
    (
      (input.deploymentExposure === "private" && input.authBaseUrlMode === "auto") ||
      input.deploymentExposure === undefined
    )
  );
}

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

export function deriveAuthTrustedOrigins(config: Config, opts?: { listenPort?: number }): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  if (config.deploymentMode === "authenticated") {
    const port = opts?.listenPort ?? config.port;
    const needsPortVariants = port !== 80 && port !== 443;
    for (const hostname of config.allowedHostnames) {
      const trimmed = hostname.trim().toLowerCase();
      if (!trimmed) continue;
      trustedOrigins.add(`https://${trimmed}`);
      trustedOrigins.add(`http://${trimmed}`);
      if (needsPortVariants) {
        trustedOrigins.add(`https://${trimmed}:${port}`);
        trustedOrigins.add(`http://${trimmed}:${port}`);
      }
    }
  }

  return Array.from(trustedOrigins);
}

/**
 * Identity a managed workspace instance compares an inbound handoff ticket
 * against. Every field comes from persisted configuration or injected runtime
 * identity — never from request headers — so a spoofed `X-Forwarded-Host` or
 * Tailscale identity header cannot retarget a ticket. Returns null when this
 * process was not started as a managed workspace, which leaves the exchange
 * endpoint unregistered.
 */
export function resolveWorkspaceHandoffIdentity(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceHandoffExpectedIdentity | null {
  const key = resolveWorkspaceHandoffLocalKey(env);
  if (!key) return null;
  const configuredOrigin =
    normalizeWorkspaceHandoffOrigin(env.PILOT_PUBLIC_URL)
    ?? (config.authBaseUrlMode === "explicit"
      ? normalizeWorkspaceHandoffOrigin(config.authPublicBaseUrl)
      : null);
  return {
    key,
    instanceId: resolvePilotInstanceId(),
    executionWorkspaceId: resolveWorkspaceHandoffLocalWorkspaceId(env),
    companyId: resolveWorkspaceHandoffLocalCompanyId(env),
    origin: configuredOrigin,
  };
}

/**
 * Keycloak OIDC sign-in (genericOAuth plugin). The issuer is the realm URL
 * (e.g. https://sso.example.com/realms/pilot); discovery pulls the authorize
 * + token endpoints, so only the realm client id/secret are needed here. The
 * redirect URI to register on the realm client is
 * `<public-base-url>/api/auth/oauth2/callback/keycloak`.
 */
export function buildKeycloakOAuthPlugin(settings: AuthKeycloakSettings) {
  return genericOAuth({
    config: [
      {
        ...keycloak({
          clientId: settings.clientId,
          clientSecret: settings.clientSecret,
          issuer: settings.issuer,
        }),
        // Skip the Keycloak username/password form entirely and go straight
        // to the Google broker — same behavior as crew's SSO flow
        // (crates/crew-relay/src/api/oidc.rs uses kc_idp_hint=google).
        authorizationUrlParams: { kc_idp_hint: "google" },
      },
    ],
  });
}

/**
 * Does this email belong to one of the allowed work domains?
 * Case-insensitive; a NULL/unparseable email never matches.
 */
export function emailDomainMatches(email: string | null | undefined, domains: readonly string[]): boolean {
  if (!email || domains.length === 0) return false;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return domains.includes(domain);
}
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const publicUrl = process.env.PILOT_PUBLIC_URL?.trim() || baseUrl;
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.PILOT_AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET (or PILOT_AGENT_JWT_SECRET) must be set. " +
      "For local development, set BETTER_AUTH_SECRET=pilot-dev-secret in your .env file.",
    );
  }
  const disableSecureCookies = shouldDisableSecureAuthCookies({
    deploymentMode: config.deploymentMode,
    deploymentExposure: config.deploymentExposure,
    authBaseUrlMode: config.authBaseUrlMode,
    authPublicBaseUrl: config.authPublicBaseUrl,
    publicUrl,
  });

  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: boardEmailPasswordEnabled(config),
      requireEmailVerification: false,
      disableSignUp: config.authDisableSignUp,
    },
    rateLimit: buildBetterAuthRateLimitOptions({
      deploymentMode: config.deploymentMode,
      deploymentExposure: config.deploymentExposure,
      override: process.env.PILOT_AUTH_RATE_LIMIT_ENABLED,
    }),
    advanced: buildBetterAuthAdvancedOptions({ disableSecureCookies }),
    plugins: [
      // Registered only for a managed workspace instance: the plugin is what makes
      // `Open workspace` password-independent, and a control-plane instance that
      // was never handed a workspace key must not expose the exchange at all.
      ...(resolveWorkspaceHandoffIdentity(config)
        ? [
            workspaceLoginHandoffPlugin({
              db,
              // Re-resolved per exchange so a hot restart cannot keep validating
              // against an origin the control plane has since republished.
              resolveExpectedIdentity: () =>
                resolveWorkspaceHandoffIdentity(config) ?? {
                  key: null,
                  instanceId: null,
                  executionWorkspaceId: null,
                  companyId: null,
                  origin: null,
                },
            }),
          ]
        : []),
      // Keycloak SSO (internal realm). Absent entirely when PILOT_KEYCLOAK_*
      // env vars are not fully set, so the OAuth endpoints stay unregistered.
      ...(config.authKeycloak ? [buildKeycloakOAuthPlugin(config.authKeycloak)] : []),
    ],
    // Domain-based access provisioning: on every sign-in, a user whose email
    // is on an allowed work domain is promoted to instance_admin and, when the
    // instance has exactly one company, joined to it as a member. Idempotent;
    // errors are logged and never block the sign-in itself.
    ...(config.ssoAutoAdminDomains.length > 0
      ? {
          databaseHooks: {
            session: {
              create: {
                after: async (session: { userId: string }) => {
                  try {
                    const user = await db
                      .select({ email: authUsers.email })
                      .from(authUsers)
                      .where(eq(authUsers.id, session.userId))
                      .then((rows) => rows[0] ?? null);
                    if (!emailDomainMatches(user?.email, config.ssoAutoAdminDomains)) return;
                    const access = accessService(db);
                    await access.promoteInstanceAdmin(session.userId);
                    const existingCompanies = await db.select({ id: companies.id }).from(companies);
                    if (existingCompanies.length === 1) {
                      const membership = await access.getMembership(existingCompanies[0].id, "user", session.userId);
                      if (!membership || membership.status !== "active") {
                        await db
                          .insert(companyMemberships)
                          .values({
                            companyId: existingCompanies[0].id,
                            principalType: "user",
                            principalId: session.userId,
                            status: "active",
                            membershipRole: "member",
                          })
                          .onConflictDoUpdate({
                            target: [companyMemberships.companyId, companyMemberships.principalType, companyMemberships.principalId],
                            set: { status: "active", updatedAt: new Date() },
                          });
                      }
                    }
                  } catch (error) {
                    console.warn(
                      `[sso] domain-based access provisioning failed for user ${session.userId}:`,
                      error instanceof Error ? error.message : error,
                    );
                  }
                },
              },
            },
          },
        }
      : {}),
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  return betterAuth(authConfig);
}

export function createBetterAuthHandler(auth: BetterAuthHandlerTarget): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthSessionResolver,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = auth.api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthSessionResolver,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
