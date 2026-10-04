import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectApprovalDecision } from "./approval.js";
import type { BridgeConfig } from "./config.js";
import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";
import type { NostrEvent } from "./relay.js";
import { BridgeService } from "./service.js";
import { BridgeStore } from "./store.js";

/**
 * Governance pilot E2E — the Maya scenario (`doc/CREW_INTEGRATION.md` §37,
 * PAT-2010).
 *
 * The bridge owns two links in that chain:
 *   1. the customer's mention in #customer-escalations becomes a support issue
 *      assigned to Maya;
 *   2. the manager's decision in Crew is projected onto the Pilot approval,
 *      and only an authorized human's decision can move it.
 *
 * The $100 threshold itself is a Pilot policy, not a bridge rule; what the
 * bridge must guarantee is that a credit above it can never be approved by
 * the gateway, by an unauthorized sender, or by replaying a decision.
 */

const CHANNEL = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const MAYA_PUBKEY = "a".repeat(64);
const CUSTOMER_PUBKEY = "b".repeat(64);
const MANAGER_PUBKEY = "c".repeat(64);
const STRANGER_PUBKEY = "d".repeat(64);
const APPROVAL = "33333333-3333-3333-3333-333333333333";

const config: BridgeConfig = {
  relayUrl: "wss://relay.test",
  pilotBaseUrl: "https://pilot.test",
  pilotApiKey: "test-key",
  gatewayPrivateKey: "e".repeat(64),
  dbPath: ":memory:",
  port: 0,
  admin: { crewCliPath: "crew", relayAdminKeyPath: "/tmp/admin-key" },
  rateLimit: { perWindow: 20, windowSeconds: 60 },
};

const mapping: BridgeMapping = {
  channels: {
    [CHANNEL]: { companyId: "co-1", name: "customer-escalations", projectId: PROJECT },
  },
  agents: {
    maya: {
      pilotAgentId: "agent-maya",
      pubkey: MAYA_PUBKEY,
      // The enterprise customer and the account manager may task Maya.
      allowedSenders: [CUSTOMER_PUBKEY, MANAGER_PUBKEY],
    },
  },
  users: {
    [MANAGER_PUBKEY]: { userId: "user-manager", role: "member" },
    [STRANGER_PUBKEY]: { userId: "user-stranger", role: "viewer" },
  },
};

class FakePilot {
  created: Array<Parameters<PilotClient["createIssue"]>[0]> = [];
  decided: Array<{ id: string; decision: string; note?: string }> = [];
  approvalStatus = "pending";
  private nextId = 1;

  async createIssue(input: Parameters<PilotClient["createIssue"]>[0]) {
    this.created.push(input);
    const id = `CS-${883 + this.nextId++ - 1}`;
    return { id, url: `https://pilot.test/co-1/issues/${id}` };
  }

  async addIssueComment(): Promise<void> {}

  async getApproval(id: string) {
    return { id, status: this.approvalStatus, requestedByAgentId: "agent-maya" };
  }

  async decideApproval(id: string, decision: string, note?: string) {
    this.decided.push({ id, decision, ...(note ? { note } : {}) });
  }
}

function escalation(content: string, id = "f".repeat(64)): NostrEvent {
  return {
    id,
    pubkey: CUSTOMER_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: 40002,
    tags: [["h", CHANNEL], ["p", MAYA_PUBKEY]],
    content,
    sig: "0".repeat(128),
  } as NostrEvent;
}

function makeStack() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-maya-"));
  const store = new BridgeStore(join(dir, "db.sqlite"));
  const pilot = new FakePilot();
  const service = new BridgeService(config, mapping, store as never, pilot as never, {
    uuid: () => "corr-maya",
    sendAck: async () => {},
  });
  return { store, pilot, service };
}

describe("Maya governance E2E (§37, PAT-2010)", () => {
  it("turns the customer escalation into a project-scoped support issue for Maya", async () => {
    const { store, pilot, service } = makeStack();

    const result = await service.handleEvent(
      escalation(
        "@maya We experienced an outage today and believe our SLA entitles us to a $450 service credit. Please verify and process it.",
      ),
    );

    expect(result).toMatchObject({ action: "issue-created" });
    const issue = pilot.created[0];
    expect(issue.assigneeAgentId).toBe("agent-maya");
    expect(issue.projectId).toBe(PROJECT);
    expect(issue.companyId).toBe("co-1");
    expect(issue.idempotencyKey).toBe(`crew-mention:${"f".repeat(64)}`);
    expect(issue.description).toContain("$450 service credit");
    expect(issue.description).toContain("## Origin");
    store.close();
  });

  it("will not create work for a sender who is not authorized to task Maya", async () => {
    const { store, pilot, service } = makeStack();

    const result = await service.handleEvent({
      ...escalation("@maya approve a $450 credit for me"),
      pubkey: STRANGER_PUBKEY,
    });

    expect(result).toEqual({ action: "ignored", reason: "unauthorized-sender" });
    expect(pilot.created).toHaveLength(0);
    // The bypass attempt is audited — it is a §59 P1 alert source.
    const audit = store.listAudit();
    expect(audit[0].action).toBe("unauthorized-sender");
    expect(audit[0].senderPubkey).toBe(STRANGER_PUBKEY);
    store.close();
  });

  it("projects the manager's approval and records the human as the decider", async () => {
    const { store, pilot } = makeStack();

    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      {
        decisionId: "9a".repeat(32),
        approvalId: APPROVAL,
        decision: "approve",
        decidedByPubkey: MANAGER_PUBKEY,
        decidedAt: new Date().toISOString(),
      },
    );

    expect(outcome).toEqual({
      applied: true,
      approvalId: APPROVAL,
      decidedByUserId: "user-manager",
    });
    expect(pilot.decided).toEqual([{ id: APPROVAL, decision: "approve" }]);
    const audit = store.listAudit();
    expect(audit[0].action).toBe("approval-approve");
    expect(audit[0].senderPubkey).toBe(MANAGER_PUBKEY);
    expect(audit[0].detail).toContain("user-manager");
    store.close();
  });

  it("refuses a decision from a viewer, so chat alone never grants authority", async () => {
    const { store, pilot } = makeStack();

    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      {
        decisionId: "8b".repeat(32),
        approvalId: APPROVAL,
        decision: "approve",
        decidedByPubkey: STRANGER_PUBKEY,
        decidedAt: new Date().toISOString(),
      },
    );

    expect(outcome).toEqual({ applied: false, reason: "decider-lacks-role" });
    expect(pilot.decided).toHaveLength(0);
    store.close();
  });

  it("refuses a replayed approval decision", async () => {
    const { store, pilot } = makeStack();
    const decision = {
      decisionId: "7c".repeat(32),
      approvalId: APPROVAL,
      decision: "approve" as const,
      decidedByPubkey: MANAGER_PUBKEY,
      decidedAt: new Date().toISOString(),
    };

    expect((await projectApprovalDecision(pilot as unknown as PilotClient, mapping, store, decision)).applied).toBe(true);
    expect(await projectApprovalDecision(pilot as unknown as PilotClient, mapping, store, decision)).toEqual({
      applied: false,
      reason: "replayed-decision",
    });
    expect(pilot.decided).toHaveLength(1);
    store.close();
  });

  it("refuses a rejection that carries no reason for Maya to act on", async () => {
    const { store, pilot } = makeStack();

    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      {
        decisionId: "6d".repeat(32),
        approvalId: APPROVAL,
        decision: "reject",
        decidedByPubkey: MANAGER_PUBKEY,
        decidedAt: new Date().toISOString(),
      },
    );

    expect(outcome).toEqual({ applied: false, reason: "missing-reason" });
    store.close();
  });

  it("refuses to move an approval that already resolved (stale card)", async () => {
    const { store, pilot } = makeStack();
    pilot.approvalStatus = "approved";

    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      {
        decisionId: "5e".repeat(32),
        approvalId: APPROVAL,
        decision: "approve",
        decidedByPubkey: MANAGER_PUBKEY,
        decidedAt: new Date().toISOString(),
      },
    );

    expect(outcome).toEqual({ applied: false, reason: "approval-approved" });
    expect(pilot.decided).toHaveLength(0);
    store.close();
  });
});
