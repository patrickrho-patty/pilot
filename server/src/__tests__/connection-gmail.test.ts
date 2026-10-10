import { describe, expect, it } from "vitest";
import { gmailMessage } from "../services/connection-gmail.js";

const plain = (text: string) => ({
  mimeType: "text/plain",
  body: { data: Buffer.from(text).toString("base64url") },
});
const message = (payload: unknown) =>
  gmailMessage({ id: "a123", threadId: "b123", payload });

describe("bounded Gmail inline text", () => {
  it("accepts only canonical unpadded or exact padded base64url", () => {
    for (const [data, text] of [
      ["", ""],
      ["Zg", "f"],
      ["Zg==", "f"],
      ["Zm8", "fo"],
      ["Zm8=", "fo"],
      ["Zm9v", "foo"],
    ]) {
      expect(message({ mimeType: "text/plain", body: { data } })).toMatchObject(
        { text, bodyStatus: "complete" },
      );
    }
    for (const data of [
      "=",
      "==",
      "Zg=",
      "Zm8==",
      "Zm9v=",
      "Zm9v==",
      "Zg===",
      "Zh",
      "A",
    ]) {
      const result = message({ mimeType: "text/plain", body: { data } });
      expect(result.bodyStatus, data).toBe("unsupported");
      expect(result.text, data).toBeUndefined();
    }
  });

  it("preserves root and ordered nested UTF-8 plain text", () => {
    expect(message(plain("Root useful text"))).toMatchObject({
      text: "Root useful text",
      bodyStatus: "complete",
    });
    expect(
      message({
        mimeType: "multipart/mixed",
        parts: [
          plain("첫 부분"),
          { mimeType: "multipart/alternative", parts: [plain("Second part")] },
        ],
      }),
    ).toMatchObject({ text: "첫 부분\nSecond part", bodyStatus: "complete" });
  });
  it("marks HTML-only and invalid encoded text unsupported", () => {
    for (const payload of [
      { mimeType: "text/html", body: { data: "SGk" } },
      { mimeType: "text/plain", body: { data: "%%%" } },
      { mimeType: "text/plain", body: { data: "_w" } },
    ]) {
      expect(message(payload)).toMatchObject({ bodyStatus: "unsupported" });
      expect(message(payload).text).toBeUndefined();
    }
  });
  it("truncates at the UTF-8 byte budget without replacement characters", () => {
    const result = message(plain("가".repeat(6000)));
    expect(result.bodyStatus).toBe("truncated");
    expect(Buffer.byteLength(result.text!)).toBe(16383);
    expect(result.text).not.toContain("�");
  });
  it("caps visited MIME parts and excludes content beyond the cap", () => {
    const result = message({
      mimeType: "multipart/mixed",
      parts: [
        ...Array.from({ length: 64 }, () => plain("part")),
        plain("beyond part limit"),
      ],
    });
    expect(result.bodyStatus).toBe("truncated");
    expect(result.text?.split("\n")).toHaveLength(63);
    expect(result.text).not.toContain("beyond part limit");
  });
  it("caps MIME depth without descending into hidden content", () => {
    let payload: unknown = plain("beyond depth limit");
    for (let i = 0; i < 10; i++)
      payload = { mimeType: "multipart/mixed", parts: [payload] };
    expect(message(payload)).toMatchObject({ bodyStatus: "truncated" });
    expect(message(payload).text).toBeUndefined();
  });
  it("never decodes attachment subtrees or fetch-only bodies", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        plain("inline"),
        {
          mimeType: "multipart/mixed",
          filename: "mail.eml",
          parts: [plain("attachment secret")],
        },
        {
          ...plain("attachment secret"),
          body: {
            attachmentId: "remote",
            data: Buffer.from("attachment secret").toString("base64url"),
          },
        },
      ],
    };
    expect(message(payload)).toMatchObject({
      text: "inline",
      bodyStatus: "complete",
    });
    expect(JSON.stringify(message(payload))).not.toContain("attachment secret");
  });
});
