import { describe, expect, it } from "vitest";
import {
  gmailDraftArguments,
  gmailMime,
} from "../services/connection-gmail-write.js";

describe("Gmail draft composition", () => {
  const mail = {
    operationId: "11111111-1111-4111-8111-111111111111",
    to: ["recipient@example.com"],
    subject: "회의 안내",
    body: "안녕하세요.\n수정된 내용입니다.",
  };
  it("encodes Korean subject and body without accepting a caller-selected sender", () => {
    const mime = Buffer.from(
      gmailMime(gmailDraftArguments.parse(mail), "owner@example.com"),
      "base64url",
    ).toString();
    expect(mime).toContain("To: recipient@example.com\r\n");
    expect(mime).toContain(
      `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`,
    );
    expect(mime).toContain(
      Buffer.from(mail.body.replace(/\n/g, "\r\n")).toString("base64"),
    );
    expect(mime).toContain("From: owner@example.com\r\n");
    expect(
      gmailDraftArguments.safeParse({ ...mail, from: "other@example.com" })
        .success,
    ).toBe(false);
  });
  it("rejects header injection, arbitrary transport, empty recipients and oversized content", () => {
    for (const change of [
      { subject: "Hi\r\nBcc: thief@example.com" },
      { to: ["x@example.com\nCc: thief@example.com"] },
      { to: [] },
      { body: "x".repeat(8193) },
      { url: "https://evil.test" },
    ])
      expect(
        gmailDraftArguments.safeParse({ ...mail, ...change }).success,
      ).toBe(false);
  });
});
