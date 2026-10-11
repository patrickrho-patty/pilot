import { describe, expect, it } from "vitest";
import { verifyConnectionGmailIdentity } from "../services/connection-gmail-identity.js";

describe("verified Gmail mailbox identity", () => {
  it("uses the authenticated profile with no message reads or additional scopes", async () => {
    const calls: unknown[] = [];
    const peer: typeof fetch = async (url, init) => {
      calls.push([url, init]);
      return Response.json({ emailAddress: "Patrick@Patty.io" });
    };
    expect(
      await verifyConnectionGmailIdentity("synthetic-token", peer),
    ).toEqual({
      issuer: "https://gmail.googleapis.com",
      subject: "patrick@patty.io",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject([
      "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",
      {
        headers: { Authorization: "Bearer synthetic-token" },
        redirect: "error",
        cache: "no-store",
      },
    ]);
  });
  it.each([
    Response.json({ emailAddress: "bad\naddress" }),
    Response.json({ access_token: "synthetic-token" }),
    new Response("synthetic-provider-secret", { status: 401 }),
    Response.json({ emailAddress: "user@example.com" }, { status: 302 }),
    new Response("x".repeat(4097)),
  ])("denies unverified profiles without exposing token or provider response", async (response) => {
    await expect(
      verifyConnectionGmailIdentity("synthetic-token", async () => response),
    ).rejects.toMatchObject({
      status: 403,
      message: "Gmail account identity could not be verified",
    });
  });
});
