import { describe, expect, it } from "vitest";
import {
  boardEmailPasswordEnabled,
  emailDomainMatches,
} from "../auth/better-auth.js";
import { parseSsoDomainList } from "../config.js";

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

describe("emailDomainMatches", () => {
  const domains = ["patty.io"];

  it("matches a same-domain email case-insensitively", () => {
    expect(emailDomainMatches("Patrick@Patty.IO", domains)).toBe(true);
    expect(emailDomainMatches("ceo@patty.io", domains)).toBe(true);
  });

  it("rejects other domains and lookalikes", () => {
    expect(emailDomainMatches("someone@notpatty.io", domains)).toBe(false);
    expect(emailDomainMatches("someone@patty.io.evil.test", domains)).toBe(false);
    expect(emailDomainMatches("patty.io@notpatty.io", domains)).toBe(false);
  });

  it("never matches a missing or malformed email", () => {
    expect(emailDomainMatches(null, domains)).toBe(false);
    expect(emailDomainMatches("", domains)).toBe(false);
    expect(emailDomainMatches("no-at-sign", domains)).toBe(false);
    expect(emailDomainMatches("patrick@patty.io", [])).toBe(false);
  });
});

describe("parseSsoDomainList", () => {
  it("normalizes, lowercases, strips @, and dedupes", () => {
    expect(parseSsoDomainList("patty.io, @Patty.IO,  foo.co ,, @bar.example.com")).toEqual([
      "patty.io",
      "foo.co",
      "bar.example.com",
    ]
    );
  });

  it("drops junk that is not a domain", () => {
    expect(parseSsoDomainList("not a domain, no-spaces@weird, ok.io")).toEqual(["ok.io"]);
    expect(parseSsoDomainList(undefined)).toEqual([]);
    expect(parseSsoDomainList("")).toEqual([]);
  });
});
