import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectApprovalDecision, type CrewDecision } from "./approval.js";
import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";
import { BridgeStore } from "./store.js";

const HUMAN = "c".repeat(64);
const APPROVAL = "11111111-1111-1111-1111-111111111111";

const mapping: BridgeMapping = {
  channels: {},
  agents: {},
  users: {
    [HUMAN]: { userId: "user-1", role: "member" },
    ["d".repeat(64)]: { userId: "user-2", role: "viewer" },
  },
};

class FakePilot {
  decided: Array<{ id: string; decision: string; note?: string }> = [];
  status = "pending";

  async getApproval(id: string) {
    return { id, status: this.status, requestedByAgentId: "agent-1" };
  }

  async decideApproval(id: string, decision: string, note?: string) {
    this.decided.push({ id, decision, ...(note ? { note } : {}) });
  }
}

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-approval-"));
  return new BridgeStore(join(dir, "db.sqlite"));
}

function decision(overrides: Partial<CrewDecision> = {}): CrewDecision {
  return {
    decisionId: "e1".repeat(32),
    approvalId: APPROVAL,
    decision: "approve",
    decidedByPubkey: HUMAN,
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("projectApprovalDecision (PAT-1987 §18.4)", () => {
  it("applies a decision from a mapped human and audits the human as decider", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision(),
    );

    expect(outcome).toEqual({ applied: true, approvalId: APPROVAL, decidedByUserId: "user-1" });
    expect(pilot.decided).toEqual([{ id: APPROVAL, decision: "approve" }]);

    const audit = store.listAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("approval-approve");
    expect(audit[0].senderPubkey).toBe(HUMAN);
    expect(audit[0].detail).toContain("user-1");
    store.close();
  });

  it("refuses a decider who is not mapped to a Pilot user", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision({ decidedByPubkey: "9".repeat(64) }),
    );
    expect(outcome).toEqual({ applied: false, reason: "unmapped-decider" });
    expect(pilot.decided).toHaveLength(0);
    store.close();
  });

  it("refuses a viewer", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision({ decidedByPubkey: "d".repeat(64) }),
    );
    expect(outcome).toEqual({ applied: false, reason: "decider-lacks-role" });
    store.close();
  });

  it("requires a reason for reject and request-revision", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    expect(
      await projectApprovalDecision(
        pilot as unknown as PilotClient,
        mapping,
        store,
        decision({ decision: "reject" }),
      ),
    ).toEqual({ applied: false, reason: "missing-reason" });
    expect(
      await projectApprovalDecision(
        pilot as unknown as PilotClient,
        mapping,
        store,
        decision({ decision: "request-revision", reason: "   " }),
      ),
    ).toEqual({ applied: false, reason: "missing-reason" });
    expect(pilot.decided).toHaveLength(0);
    store.close();
  });

  it("refuses a stale decision rather than applying old intent", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision({ decidedAt: new Date(Date.now() - 3600_000).toISOString() }),
    );
    expect(outcome).toEqual({ applied: false, reason: "stale-decision" });
    store.close();
  });

  it("refuses a replayed decision id — the same decision can never apply twice", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    const first = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision(),
    );
    const second = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision(),
    );
    expect(first.applied).toBe(true);
    expect(second).toEqual({ applied: false, reason: "replayed-decision" });
    expect(pilot.decided).toHaveLength(1);
    store.close();
  });

  it("refuses when the approval already moved on (stale card)", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    pilot.status = "approved";
    const outcome = await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision(),
    );
    expect(outcome).toEqual({ applied: false, reason: "approval-approved" });
    expect(pilot.decided).toHaveLength(0);
    store.close();
  });

  it("records a rejection reason in the audit detail", async () => {
    const store = makeStore();
    const pilot = new FakePilot();
    await projectApprovalDecision(
      pilot as unknown as PilotClient,
      mapping,
      store,
      decision({ decision: "reject", reason: "over the $100 threshold" }),
    );
    expect(pilot.decided[0]?.note).toBe("over the $100 threshold");
    expect(store.listAudit()[0]?.detail).toContain("over the $100 threshold");
    store.close();
  });
});
