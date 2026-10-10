import { connectionDirectFetch } from "./connection-direct-tls.js";
import { eq } from "drizzle-orm";
import { connectionWorkspaceBindings, type Db } from "@pilotai/db";
import {
  connectionAuthorityResponseSchema,
  connectionWorkspaceBindingSchema,
  resolveConnectionAuthorityInputSchema,
  type ConnectionWorkspaceBinding,
  type ResolveConnectionAuthorityInput,
  type ResolvedConnectionAuthority,
} from "@pilotai/shared";
import { forbidden, HttpError } from "../errors.js";

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 65_536;

function denied() {
  return forbidden("Connection authority denied", { code: "connection_authority_denied" });
}

function unavailable() {
  return new HttpError(503, "Connection authority unavailable", { code: "connection_authority_unavailable" });
}

// Unlike the existing OAuth/MCP readers, this never buffers an unbounded body.
async function readAuthorityBody(response: Response, signal: AbortSignal): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => {});
    throw unavailable();
  }
  if (!response.body) throw denied();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw unavailable();
      const { done, value } = await reader.read();
      if (signal.aborted) throw unavailable();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw unavailable();
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

/** Test transport override; production uses explicit direct TLS without ambient proxies. */
export interface ConnectionAuthorityServiceOptions {
  fetch?: typeof fetch;
}

/** Resolves only an operator-registered, current Crew resource identity. */
export function connectionAuthorityService(db: Db, options: ConnectionAuthorityServiceOptions = {}) {
  const fetchAuthority = options.fetch ?? connectionDirectFetch;

  async function loadBinding(id: string): Promise<ConnectionWorkspaceBinding> {
    const [row] = await db.select().from(connectionWorkspaceBindings)
      .where(eq(connectionWorkspaceBindings.id, id)).limit(1);
    const parsed = connectionWorkspaceBindingSchema.safeParse(row);
    if (!parsed.success || !parsed.data.enabled) throw denied();
    return parsed.data;
  }

  /** Every call fetches current storage and a fresh trusted-origin verdict. */
  async function resolveConnectionAuthority(input: ResolveConnectionAuthorityInput): Promise<ResolvedConnectionAuthority> {
    const parsedInput = resolveConnectionAuthorityInputSchema.safeParse(input);
    if (!parsedInput.success) throw denied();
    const expected = parsedInput.data;
    const binding = await loadBinding(expected.bindingId);
    const body = JSON.stringify({ schema: "crew.connection-introspection/v1", token: expected.token });
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) throw denied();

    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(unavailable()); }, REQUEST_TIMEOUT_MS);
    });
    try {
      const verdict = await Promise.race([
        (async () => {
          let response: Response;
          try {
            response = await fetchAuthority(binding.authorityUrl, {
              method: "POST", redirect: "error", cache: "no-store", signal: abort.signal,
              headers: { "content-type": "application/json", accept: "application/json", "cache-control": "no-store" },
              body,
            });
          } catch {
            throw unavailable();
          }
          if (!response.ok || response.redirected || (response.url && response.url !== binding.authorityUrl)) {
            void response.body?.cancel().catch(() => {});
            throw unavailable();
          }
          let raw: unknown;
          const text = await readAuthorityBody(response, abort.signal);
          try { raw = JSON.parse(text); } catch { throw denied(); }
          const parsed = connectionAuthorityResponseSchema.safeParse(raw);
          if (!parsed.success) throw denied();
          return parsed.data.context;
        })(),
        timeout,
      ]);

      const schema = expected.purpose === "management" ? "crew.connection-management/v1" : "crew.connection-execution/v1";
      if (verdict.schema !== schema
        || verdict.action !== expected.action
        || verdict.accountsOrganizationId !== binding.accountsOrganizationId
        || verdict.workspaceId !== binding.workspaceId
        || verdict.communityId !== binding.communityId) throw denied();
      if (expected.purpose === "management") {
        if (verdict.schema !== "crew.connection-management/v1"
          || verdict.requestDigest !== expected.requestDigest) throw denied();
      }

      // Reject in-flight disable/rebinding too; a stale lookup is not authority.
      const current = await loadBinding(binding.id);
      if (current.companyId !== binding.companyId || current.accountsOrganizationId !== binding.accountsOrganizationId
        || current.workspaceId !== binding.workspaceId || current.communityId !== binding.communityId
        || current.authorityUrl !== binding.authorityUrl || current.updatedAt.getTime() !== binding.updatedAt.getTime()) throw denied();
      const now = Math.floor(Date.now() / 1_000);
      if (verdict.issuedAt > now || verdict.expiresAt <= now) throw denied();
      return { binding: current, context: verdict };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // Do not expose upstream bodies, URLs, token strings or fetch/parse errors.
      throw unavailable();
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
  return { resolveConnectionAuthority };
}
