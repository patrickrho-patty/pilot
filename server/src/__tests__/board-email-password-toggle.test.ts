import { describe, expect, it } from "vitest";
import { boardEmailPasswordEnabled } from "../auth/better-auth.js";

describe("boardEmailPasswordEnabled", () => {
  it("keeps email sign-in available without Keycloak", () => {
    expect(boardEmailPasswordEnabled({ authKeycloak: null })).toBe(true);
  });

  it("disables email sign-in on SSO-only instances", () => {
    expect(
      boardEmailPasswordEnabled({
        authKeycloak: {
          issuer: "https://login.patty.io/realms/internal",
          clientId: "pilot-board",
          clientSecret: "secret",
        },
      }),
    ).toBe(false);
  });
});
