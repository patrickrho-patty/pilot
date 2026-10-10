import { z } from "zod";

const headers = z
  .array(z.object({ name: z.string().max(128), value: z.string().max(4096) }))
  .max(100);
const part = z.object({
  mimeType: z.string().max(100),
  filename: z.string().max(1024).optional(),
  headers: headers.optional(),
  body: z
    .object({
      data: z.string().max(65536).optional(),
      attachmentId: z.string().optional(),
    })
    .optional(),
  // Parse one level at a time: untrusted nesting must not recurse without bounds.
  parts: z.array(z.unknown()).optional(),
});
const MAX_DEPTH = 8;
const MAX_PARTS = 64;
const MAX_TEXT_BYTES = 16384;

/** Return bounded inline plain text; attachments are never decoded or fetched. */
export function gmailMessage(raw: unknown) {
  const value = z
    .object({
      id: z.string().regex(/^[a-fA-F0-9]{1,64}$/),
      threadId: z.string().max(64),
      snippet: z.string().max(8192).optional(),
      payload: z.unknown().optional(),
    })
    .parse(raw);
  const root = part.safeParse(value.payload);
  const stack: { raw: unknown; depth: number }[] =
    value.payload === undefined ? [] : [{ raw: value.payload, depth: 0 }];
  let visited = 0,
    bytes = 0,
    truncated = false,
    unsupported = false,
    found = false;
  const chunks: string[] = [];
  while (stack.length && visited < MAX_PARTS) {
    const next = stack.pop();
    if (!next) break;
    visited++;
    const parsed = part.safeParse(next.raw);
    if (!parsed.success) {
      unsupported = true;
      continue;
    }
    const p = parsed.data;
    if (
      p.filename ||
      p.body?.attachmentId ||
      p.headers?.some(
        (h) =>
          h.name.toLowerCase() === "content-disposition" &&
          /^\s*attachment(?:\s*;|\s*$)/i.test(h.value),
      )
    )
      continue;
    if (p.mimeType.toLowerCase() === "text/plain") {
      const data = p.body?.data;
      if (data === undefined) {
        unsupported = true;
        continue;
      }
      const unpadded = data.replace(/=+$/, "");
      const padding = data.length - unpadded.length;
      const expectedPadding = (4 - (unpadded.length % 4)) % 4;
      if (
        !/^[A-Za-z0-9_-]*={0,2}$/.test(data) ||
        unpadded.length % 4 === 1 ||
        (padding > 0 && (unpadded.length === 0 || padding !== expectedPadding))
      ) {
        unsupported = true;
        continue;
      }
      const decoded = Buffer.from(data, "base64url");
      if (decoded.toString("base64url") !== data.replace(/=+$/, "")) {
        unsupported = true;
        continue;
      }
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(decoded);
      } catch {
        unsupported = true;
        continue;
      }
      found = true;
      const separator = chunks.length ? "\n" : "";
      const remaining = Math.max(0, MAX_TEXT_BYTES - bytes - separator.length);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        decoded.subarray(0, remaining),
        { stream: true },
      );
      if (
        decoded.length > remaining ||
        separator.length > MAX_TEXT_BYTES - bytes
      )
        truncated = true;
      if (text) {
        chunks.push(separator + text);
        bytes += Buffer.byteLength(separator + text);
      }
    } else if (p.mimeType.toLowerCase().startsWith("multipart/")) {
      if (!p.parts?.length) {
        unsupported = true;
        continue;
      }
      if (next.depth >= MAX_DEPTH) {
        truncated = true;
        continue;
      }
      // Bound the work queue too, even if a single part has thousands of children.
      const capacity = Math.max(0, MAX_PARTS - visited - stack.length);
      if (p.parts.length > capacity) truncated = true;
      for (let i = Math.min(p.parts.length, capacity) - 1; i >= 0; i--) {
        stack.push({ raw: p.parts[i], depth: next.depth + 1 });
      }
    }
  }
  if (stack.length) truncated = true;
  return {
    id: value.id,
    threadId: value.threadId,
    snippet: value.snippet,
    headers: root.success
      ? root.data.headers?.filter((h) =>
          ["from", "to", "cc", "bcc", "subject", "date"].includes(h.name.toLowerCase()),
        )
      : undefined,
    text: found ? chunks.join("") : undefined,
    // "complete" describes inline plain text, not HTML or excluded attachments.
    bodyStatus:
      truncated || (found && unsupported)
        ? "truncated"
        : found
          ? "complete"
          : "unsupported",
  };
}
