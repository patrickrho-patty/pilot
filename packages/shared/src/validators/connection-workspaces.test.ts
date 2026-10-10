import { describe, expect, it } from "vitest";
import * as shared from "../index.js";

// Hand-authored wire fixture: expected identities do not come from a schema builder.
const context = {
  schema: "crew.connection-management/v1",
  audience: "patty.connections",
  accountsOrganizationId: "organization-1",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  communityId: "22222222-2222-4222-8222-222222222222",
  requesterAccountId: "account-1",
  requesterPubkey: "a".repeat(64),
  issuedAt: 1_000,
  expiresAt: 1_060,
  role: "member",
  requestId: "b".repeat(64),
  action: "connections.list",
  requestDigest: "c".repeat(64),
};
const execution = {
  schema: "crew.connection-execution/v1",
  action: "gmail.search",
  audience: "patty.connections",
  accountsOrganizationId: "organization-1",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  communityId: "22222222-2222-4222-8222-222222222222",
  requesterAccountId: "account-1",
  requesterPubkey: "a".repeat(64),
  issuedAt: 1_000,
  expiresAt: 1_060,
  agentPubkey: "d".repeat(64),
  enrollmentId: "33333333-3333-4333-8333-333333333333",
  generation: 1,
  channelId: "44444444-4444-4444-8444-444444444444",
  conversationId: "channel:44444444-4444-4444-8444-444444444444",
  turnId: "55555555-5555-4555-8555-555555555555",
  sourceMemberAccountIds: ["account-1"],
  audienceAccountIds: ["account-1"],
};

describe("shared Crew Connections wire contract", () => {
  it("exports and accepts the strict versioned management response", () => {
    expect(shared).toHaveProperty("connectionAuthorityResponseSchema");
    expect(shared.connectionAuthorityResponseSchema.safeParse({
      schema: "crew.connection-authority/v1", valid: true, context,
    }).success).toBe(true);
  });

  it.each([
    ["ambiguous execution field", { agentPubkey: "d".repeat(64) }],
    ["unknown field", { extra: true }],
    ["unrecognized schema", { schema: "native.gateway/v1" }],
    ["wrong audience", { audience: "model" }],
    ["uppercase pubkey", { requesterPubkey: "A".repeat(64) }],
    ["short event id", { requestId: "event-1" }],
    ["short digest", { requestDigest: "digest" }],
    ["blank immutable id", { requesterAccountId: " " }],
    ["overlong immutable id", { accountsOrganizationId: "x".repeat(257) }],
    ["invalid workspace UUID", { workspaceId: "workspace" }],
    ["invalid community UUID", { communityId: "community" }],
    ["overlong action", { action: "x".repeat(129) }],
    ["fractional timestamp", { issuedAt: 1_000.5 }],
    ["negative timestamp", { issuedAt: -1 }],
    ["empty lifetime", { expiresAt: 1_000 }],
    ["overlong lifetime", { expiresAt: 1_061 }],
  ])("rejects %s", (_name, override) => {
    expect(shared.connectionAuthorityResponseSchema.safeParse({
      schema: "crew.connection-authority/v1", valid: true, context: { ...context, ...override },
    }).success).toBe(false);
  });

  it.each([
    "http://relay.test/api/connections/introspect",
    "https://user:password@relay.test/api/connections/introspect",
    "https://relay.test/api/connections/introspect?token=secret",
    "https://relay.test/api/connections/introspect#fragment",
    "https://relay.test/api/connections/introspect?",
    "https://relay.test/api/connections/introspect/",
    "https://relay.test/other/../api/connections/introspect",
  ])("rejects untrusted endpoint shape %s", (value) => {
    expect(shared.connectionAuthorityUrlSchema.safeParse(value).success).toBe(false);
  });

  it("accepts only the opaque token introspection envelope", () => {
    expect(shared.connectionIntrospectionRequestSchema.safeParse({
      schema: "crew.connection-introspection/v1", token: "opaque-purpose-capability",
    }).success).toBe(true);
    for (const extra of [{ purpose: "management" }, { requesterAccountId: "spoof" }, { authorityUrl: "https://evil.test" }]) {
      expect(shared.connectionIntrospectionRequestSchema.safeParse({
        schema: "crew.connection-introspection/v1", token: "opaque-purpose-capability", ...extra,
      }).success).toBe(false);
    }
  });

  it("enforces the maximum lifetime when validating a management context directly", () => {
    expect(shared.connectionManagementContextSchema.safeParse({ ...context, expiresAt: 1_061 }).success).toBe(false);
  });
  it("accepts the same bounded action grammar for execution", () => {
    for (const action of ["a", "gmail.search", "kb:page_read-v1", "a".repeat(128)]) {
      expect(shared.connectionExecutionContextSchema.safeParse({ ...execution, action }).success).toBe(true);
    }
  });
  it.each([
    ["missing action", { action: undefined }],
    ["uppercase action", { action: "Gmail.read" }],
    ["action whitespace", { action: "gmail. read" }],
    ["overlong action", { action: "x".repeat(129) }],
    ["non-UUID channel", { channelId: "channel-1" }],
    ["overlong lifetime", { expiresAt: 1_061 }],
    ["pre-start generation", { generation: 0 }],
    ["invalid enrollment", { enrollmentId: "enrollment-1" }],
    ["invalid turn", { turnId: "turn-1" }],
    ["duplicate source", { sourceMemberAccountIds: ["account-1", "account-1"] }],
    ["empty audience", { audienceAccountIds: [] }],
    ["overlong audience", { audienceAccountIds: Array.from({ length: 101 }, (_, index) => `account-${index}`) }],
    ["mixed management context", { role: "admin" }],
  ])("rejects execution context %s", (_case, override) => {
    expect(shared.connectionExecutionContextSchema.safeParse({ ...execution, ...override }).success).toBe(false);
  });
});
