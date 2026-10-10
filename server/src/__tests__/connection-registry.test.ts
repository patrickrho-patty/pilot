import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";
import { verifyConnectionKbIdentity, connectionRegistrationReady } from "../services/connection-registry.js";
import type { connectionProviderRegistrations, connectionWorkspaceBindings } from "@pilotai/db";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "registered", alg: "RS256", use: "sig" };
const registration = {
  clientId: "crew-registered",
  audience: "https://mcp.kb.patty.io",
  appId: "patty-kb",
  qualified: true,
  redirectUri: "https://crew.example/api/connections/oauth/callback",
} as typeof connectionProviderRegistrations.$inferSelect;
const issuer = "https://login.patty.io/realms/internal";
const fetcher: typeof fetch = async (input) => {
  expect(String(input)).toBe(`${issuer}/protocol/openid-connect/certs`);
  return Response.json({ keys: [jwk] });
};
function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "registered" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: issuer,
      azp: "crew-registered",
      aud: "https://mcp.kb.patty.io",
      sub: "immutable-kb-sub",
      scope: "mcp:tools",
      exp: Math.floor(Date.now() / 1000) + 60,
      ...overrides,
    }),
  ).toString("base64url");
  return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), keys.privateKey).toString("base64url")}`;
}
it("maps only a cryptographically verified issuer/subject with exact client audience scope and expiry", async () => {
  expect(await verifyConnectionKbIdentity(token(), registration, fetcher)).toEqual({
    issuer,
    subject: "immutable-kb-sub",
  });
  for (const claim of [
    { iss: "https://other.test" },
    { azp: "device-client" },
    { aud: "https://mcp.kb.patty.io/mcp" },
    { sub: "" },
    { scope: "openid" },
    { exp: 1 },
    { nbf: 9999999999 },
  ])
    await expect(verifyConnectionKbIdentity(token(claim), registration, fetcher)).rejects.toMatchObject({
      status: 403,
    });
  const forged = token().split(".");
  forged[1] = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
  await expect(verifyConnectionKbIdentity(forged.join("."), registration, fetcher)).rejects.toMatchObject({
    status: 403,
  });
});
it("readiness requires explicit operator qualification, exact callback and KB audience", () => {
  const binding = {
    authorityUrl: "https://crew.example/api/connections/introspect",
  } as typeof connectionWorkspaceBindings.$inferSelect;
  expect(connectionRegistrationReady(binding, registration)).toBe(true);
  for (const change of [
    { qualified: false },
    { clientId: "" },
    { audience: null },
    { redirectUri: "https://other.example/api/connections/oauth/callback" },
  ])
    expect(connectionRegistrationReady(binding, { ...registration, ...change })).toBe(false);
});
