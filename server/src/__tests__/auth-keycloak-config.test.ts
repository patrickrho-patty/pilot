import { describe, expect, it } from "vitest";
import { resolveAuthKeycloakSettings } from "../config.js";

describe("resolveAuthKeycloakSettings", () => {
  it("reports every name as missing when nothing is set (SSO fully off, no warning)", () => {
    const result = resolveAuthKeycloakSettings({});
    expect(result.settings).toBeNull();
    expect(result.missing).toEqual([
      "PILOT_KEYCLOAK_ISSUER",
      "PILOT_KEYCLOAK_CLIENT_ID",
      "PILOT_KEYCLOAK_CLIENT_SECRET",
    ]);
  });

  it("builds settings when all variables are set", () => {
    const result = resolveAuthKeycloakSettings({
      PILOT_KEYCLOAK_ISSUER: "https://sso.example.test/realms/pilot/",
      PILOT_KEYCLOAK_CLIENT_ID: "pilot-board",
      PILOT_KEYCLOAK_CLIENT_SECRET: "secret",
    });
    expect(result.settings).toEqual({
      // Trailing slash stripped: discovery appends /.well-known/openid-configuration.
      issuer: "https://sso.example.test/realms/pilot",
      clientId: "pilot-board",
      clientSecret: "secret",
    });
    expect(result.missing).toEqual([]);
  });

  it("reports exactly the missing names on a partial set", () => {
    const result = resolveAuthKeycloakSettings({
      PILOT_KEYCLOAK_ISSUER: "https://sso.example.test/realms/pilot",
      PILOT_KEYCLOAK_CLIENT_SECRET: "secret",
    });
    expect(result.settings).toBeNull();
    expect(result.missing).toEqual(["PILOT_KEYCLOAK_CLIENT_ID"]);
  });

  it("treats whitespace-only values as unset", () => {
    const result = resolveAuthKeycloakSettings({
      PILOT_KEYCLOAK_ISSUER: "  ",
      PILOT_KEYCLOAK_CLIENT_ID: "pilot-board",
      PILOT_KEYCLOAK_CLIENT_SECRET: "secret",
    });
    expect(result.settings).toBeNull();
    expect(result.missing).toEqual(["PILOT_KEYCLOAK_ISSUER"]);
  });
});
