import { describe, expect, it } from "vitest";
import { connectionControlSchema, connectionOAuthCallbackSchema } from "./connection-actions.js";
describe("frozen Crew control contract", () => {
  const base = { schema: "crew.connections-control/v1", requestId: "11111111-1111-4111-8111-111111111111" };
  it("accepts approval decisions but not owner or callback injection", () => {
    expect(
      connectionControlSchema.safeParse({
        ...base,
        operation: "access.request-resolve",
        parameters: { approvalRequestId: base.requestId, approved: true },
      }).success,
    ).toBe(true);
    for (const parameters of [
      { connectionId: base.requestId, owner: "other" },
      { connectionId: base.requestId, redirectUri: "https://evil.test" },
    ])
      expect(
        connectionControlSchema.safeParse({ ...base, operation: "connection.authorize", parameters }).success,
      ).toBe(false);
  });
  it("accepts explicit writing and sending but refuses unknown or duplicate actions", () => {
    expect(connectionControlSchema.safeParse({ ...base, operation: "availability.set", parameters: { appId: "gmail", enabled: true, actions: ["read", "search", "write", "send"] } }).success).toBe(true);
    for (const actions of [["delete"], ["read", "read"], []])
      expect(
        connectionControlSchema.safeParse({
          ...base,
          operation: "availability.set",
          parameters: { appId: "gmail", enabled: true, actions },
        }).success,
      ).toBe(false);
  });
  it("accepts only ephemeral exact success or safe provider error variants", () => {
    expect(
      connectionOAuthCallbackSchema.safeParse({
        schema: "crew.connection-oauth-callback/v1",
        state: "state",
        code: "code",
      }).success,
    ).toBe(true);
    expect(
      connectionOAuthCallbackSchema.safeParse({
        schema: "crew.connection-oauth-callback/v1",
        state: "state",
        error: "access_denied",
      }).success,
    ).toBe(true);
    expect(
      connectionOAuthCallbackSchema.safeParse({
        schema: "crew.connection-oauth-callback/v1",
        state: "state",
        error: "provider-token",
        code: "code",
      }).success,
    ).toBe(false);
  });
  it("accepts only the optional pinned issuer without expanding the private callback surface", () => {
    for (const iss of ["https://accounts.google.com", "https://login.patty.io/realms/internal"]) {
      for (const fields of [{ code: "code" }, { error: "access_denied" }])
        expect(
          connectionOAuthCallbackSchema.safeParse({
            schema: "crew.connection-oauth-callback/v1",
            state: "opaque",
            ...fields,
            iss,
          }).success,
        ).toBe(true);
    }
    for (const extra of [
      { iss: "https://evil.example" },
      { iss: "https://accounts.google.com/" },
      { scope: "email" },
      { authuser: "0" },
    ])
      expect(
        connectionOAuthCallbackSchema.safeParse({
          schema: "crew.connection-oauth-callback/v1",
          state: "opaque",
          code: "code",
          ...extra,
        }).success,
      ).toBe(false);
  });
});
