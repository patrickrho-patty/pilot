import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BridgeConfig } from "./config.js";
import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";
import type { NostrEvent } from "./relay.js";
import { BridgeService, type AckSender, type HandleResult } from "./service.js";
import { BridgeStore } from "./store.js";

const AGENT_PUBKEY = "a".repeat(64);
const BOSS_PUBKEY = "b".repeat(64);
const STRANGER_PUBKEY = "c".repeat(64);
const CHANNEL_ID = "11111111-1111-1111-1111-111111111111";

const config: BridgeConfig = {
  relayUrl: "wss://relay.test",
  pilotBaseUrl: "https://pilot.test",
  pilotApiKey: "test-key",
  gatewayPrivateKey: "d".repeat(64),
  dbPath: ":memory:",
  port: 0,
  admin: { crewCliPath: "crew", relayAdminKeyPath: "/tmp/admin-key" },
  rateLimit: { perWindow: 20, windowSeconds: 60 },
};

const mapping: BridgeMapping = {
  channels: { [CHANNEL_ID]: { companyId: "co-1", name: "market-intel" } },
  agents: {
    christina: {
      pilotAgentId: "agent-1",
      pubkey: AGENT_PUBKEY,
      allowedSenders: [BOSS_PUBKEY],
    },
  },
  // PAT-1999: the manager who may decide an approval.
  users: {
    [BOSS_PUBKEY]: { userId: "user-manager", role: "member" },
    [STRANGER_PUBKEY]: { userId: "user-viewer", role: "viewer" },
  },
};

class FakePilot {
  created: Array<Parameters<PilotClient["createIssue"]>[0]> = [];
  comments: Array<{ issueId: string; bodyText: string }> = [];
  descriptionUpdates: Array<{ issueId: string; description: string }> = [];
  /** Checkout state returned by getIssue; null means not yet picked up. */
  assigneeAgentId: string | null = null;
  private nextId = 1;

  async createIssue(input: Parameters<PilotClient["createIssue"]>[0]) {
    this.created.push(input);
    const id = `iss-${this.nextId++}`;
    return { id, url: `https://pilot.test/co-1/issues/${id}` };
  }

  async addIssueComment(issueId: string, bodyText: string): Promise<void> {
    this.comments.push({ issueId, bodyText });
  }

  async getIssue(issueId: string) {
    return { id: issueId, assigneeAgentId: this.assigneeAgentId };
  }

  /** PAT-1999: approval state the decision path reads. */
  approvalStatus = "pending";
  decisions: Array<{ approvalId: string; decision: string; note?: string }> = [];

  async getApproval(approvalId: string) {
    return { id: approvalId, status: this.approvalStatus, requestedByAgentId: "agent-1" };
  }

  async decideApproval(approvalId: string, decision: string, note?: string) {
    this.decisions.push({ approvalId, decision, ...(note ? { note } : {}) });
  }

  async updateIssueDescription(issueId: string, description: string): Promise<void> {
    this.descriptionUpdates.push({ issueId, description });
  }
}

function makeAck() {
  const calls: Array<{ channel: string; replyTo: string; text: string }> = [];
  const sendAck: AckSender = async (channel, replyTo, text) => {
    calls.push({ channel, replyTo, text });
  };
  return { calls, sendAck };
}

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: Math.random().toString(16).slice(2).padEnd(64, "0"),
    pubkey: BOSS_PUBKEY,
    created_at: Math.floor(Date.now() / 1000),
    kind: 40002,
    tags: [
      ["h", CHANNEL_ID],
      ["p", AGENT_PUBKEY],
    ],
    content: "Please compare the three competitors and prepare a recommendation.",
    sig: "0".repeat(128),
    ...overrides,
  } as NostrEvent;
}

function makeService() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
  const store = new BridgeStore(join(dir, "db.sqlite"));
  const pilot = new FakePilot();
  const ack = makeAck();
  let counter = 0;
  const service = new BridgeService(config, mapping, store as never, pilot as never, {
    uuid: () => `corr-${++counter}`,
    sendAck: ack.sendAck,
  });
  return { store, pilot, ack, service };
}

describe("BridgeService", () => {
  it("creates an assigned issue, links the thread, acks, and marks seen", async () => {
    const { store, pilot, ack, service } = makeService();
    const event = makeEvent();

    const result = await service.handleEvent(event);
    expect(result).toMatchObject({ action: "issue-created", issueId: "iss-1" });

    expect(pilot.created).toHaveLength(1);
    const created = pilot.created[0];
    expect(created.companyId).toBe("co-1");
    expect(created.assigneeAgentId).toBe("agent-1");
    expect(created.title).toBe(
      "Please compare the three competitors and prepare a recommendation.",
    );
    expect(created.description).toContain("## Origin");
    expect(created.description).toContain(`crew://message?channel=${CHANNEL_ID}&id=${event.id}`);
    expect(created.description).toContain("Gateway correlation id: `corr-1`");

    // thread ↔ issue correlation persisted
    expect(store.issueForThread(event.id)?.issueId).toBe("iss-1");
    // receipt marked
    expect(store.seen(event.id)).toBe(true);
    // gateway ack sent with the issue url
    expect(ack.calls).toEqual([
      {
        channel: CHANNEL_ID,
        replyTo: event.id,
        text: "Filed as a Pilot issue for christina: https://pilot.test/co-1/issues/iss-1",
      },
    ]);
  });

  it("does not double-create on replay of the same event id", async () => {
    const { pilot, service } = makeService();
    const event = makeEvent();
    await service.handleEvent(event);
    const second: HandleResult = await service.handleEvent(event);
    expect(second).toEqual({ action: "ignored", reason: "duplicate" });
    expect(pilot.created).toHaveLength(1);
  });

  it("follow-ups in a linked thread comment the same issue instead of creating one", async () => {
    const { pilot, ack, service } = makeService();
    const root = makeEvent();
    await service.handleEvent(root);

    const followUp = makeEvent({
      id: "f".repeat(64),
      tags: [["h", CHANNEL_ID], ["e", root.id, "", "root"], ["p", AGENT_PUBKEY]],
      content: "Please add pricing-page screenshots and separate enterprise from SMB.",
    });
    const result = await service.handleEvent(followUp);
    expect(result).toEqual({ action: "commented", issueId: "iss-1" });
    expect(pilot.created).toHaveLength(1);
    expect(pilot.comments).toHaveLength(1);
    expect(pilot.comments[0].issueId).toBe("iss-1");
    expect(pilot.comments[0].bodyText).toContain("[@christina](agent://agent-1)");
    expect(pilot.comments[0].bodyText).toContain("pricing-page screenshots");
    expect(ack.calls[1]?.text).toContain("https://pilot.test/co-1/issues/iss-1");
  });

  it("ignores thread messages that do not mention the agent", async () => {
    const { pilot, service } = makeService();
    const root = makeEvent();
    await service.handleEvent(root);
    const chatter = makeEvent({
      id: "e".repeat(64),
      tags: [["h", CHANNEL_ID], ["e", root.id, "", "root"]],
      content: "thanks all",
    });
    const result = await service.handleEvent(chatter);
    expect(result).toEqual({ action: "ignored", reason: "no-agent-mention" });
    expect(pilot.comments).toHaveLength(0);
  });

  it("rejects senders not in allowedSenders", async () => {
    const { pilot, service } = makeService();
    const result = await service.handleEvent(
      makeEvent({ pubkey: STRANGER_PUBKEY }),
    );
    expect(result).toEqual({ action: "ignored", reason: "unauthorized-sender" });
    expect(pilot.created).toHaveLength(0);
  });

  it("ignores unmapped channels and unknown mention targets", async () => {
    const { pilot, service } = makeService();
    expect(
      await service.handleEvent(
        makeEvent({ tags: [["h", "other-channel"], ["p", AGENT_PUBKEY]] }),
      ),
    ).toEqual({ action: "ignored", reason: "unmapped-channel" });
    expect(
      await service.handleEvent(
        makeEvent({ tags: [["h", CHANNEL_ID], ["p", "9".repeat(64)]] }),
      ),
    ).toEqual({ action: "ignored", reason: "no-agent-mention" });
    expect(pilot.created).toHaveLength(0);
  });

  it("ignores non-message kinds", async () => {
    const { pilot, service } = makeService();
    expect(await service.handleEvent(makeEvent({ kind: 1 }))).toEqual({
      action: "ignored",
      reason: "unsupported-kind",
    });
    expect(pilot.created).toHaveLength(0);
  });

  it("accepts both message kinds — clients publish 9, the read-compat kind is 40002", async () => {
    // Regression: the relay stores 9 and 40002 as separate events and does not
    // expand one into the other on read, so a bridge that only accepted 40002
    // dropped every message a client sent.
    const nine = makeService();
    const r9 = await nine.service.handleEvent(makeEvent({ id: "9a".repeat(32), kind: 9 }));
    expect(r9).toMatchObject({ action: "issue-created" });
    expect(nine.pilot.created).toHaveLength(1);
    nine.store.close();

    const v2 = makeService();
    const r40002 = await v2.service.handleEvent(
      makeEvent({ id: "9b".repeat(32), kind: 40002 }),
    );
    expect(r40002).toMatchObject({ action: "issue-created" });
    v2.store.close();
  });

  it("does not mark the receipt when the Pilot write fails, so it can retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const failing = {
      createIssue: async () => {
        throw new Error("Pilot API 503");
      },
      addIssueComment: async () => {},
    };
    const ack = makeAck();
    const service = new BridgeService(config, mapping, store as never, failing as never, {
      uuid: () => "corr-x",
      sendAck: ack.sendAck,
    });
    const event = makeEvent();
    await expect(service.handleEvent(event)).rejects.toThrow("Pilot API 503");
    expect(store.seen(event.id)).toBe(false);
    // retry after the failure succeeds
    const pilot = new FakePilot();
    const service2 = new BridgeService(config, mapping, store as never, pilot as never, {
      uuid: () => "corr-y",
      sendAck: ack.sendAck,
    });
    const result = await service2.handleEvent(event);
    expect(result).toMatchObject({ action: "issue-created", issueId: "iss-1" });
    store.close();
  });

  it("truncates long first lines for the issue title", async () => {
    const { pilot, service } = makeService();
    await service.handleEvent(makeEvent({ content: `${"x".repeat(200)}\nsecond line` }));
    expect(pilot.created[0]?.title.length).toBeLessThanOrEqual(80);
    expect(pilot.created[0]?.title.endsWith("…")).toBe(true);
  });

  it("routes a repo pull request to the mapped employee with an idempotency key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const pilot = new FakePilot();
    const ack = makeAck();
    const repoRef = `30617:${AGENT_PUBKEY}:pilot`;
    const gitMapping: BridgeMapping = {
      ...mapping,
      repos: { [repoRef]: { companyId: "co-1", agent: "christina" } },
    };
    const service = new BridgeService(gitMapping, gitMapping, store as never, pilot as never, {
      uuid: () => "corr-git",
      sendAck: ack.sendAck,
    });

    const pr = makeEvent({
      id: "7a".repeat(32),
      kind: 1618,
      tags: [
        ["a", repoRef],
        ["subject", "Harden the release signing path"],
        ["t", "security"],
        ["c", "a".repeat(40)],
      ],
      content: "Signs releases with the wrong key on retry.",
    });

    const result = await service.handleEvent(pr);
    expect(result).toMatchObject({ action: "git-issue-created", issueId: "iss-1" });
    const created = pilot.created[0];
    expect(created.assigneeAgentId).toBe("agent-1");
    expect(created.title).toBe("Harden the release signing path");
    expect(created.idempotencyKey).toBe(`crew-git:${pr.id}`);
    expect(created.description).toContain("crew://repo/" + repoRef);
    expect(created.description).toContain("Labels: security");
    expect(created.description).toContain("Commit: `" + "a".repeat(40) + "`");

    // A replay of the same PR event must not file a second issue.
    expect(await service.handleEvent(pr)).toEqual({ action: "ignored", reason: "duplicate" });
    expect(pilot.created).toHaveLength(1);
    store.close();
  });

  it("ignores git events for unmapped repos", async () => {
    const { service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "8b".repeat(32),
        kind: 1618,
        tags: [["a", `30617:${AGENT_PUBKEY}:other`], ["subject", "x"]],
        content: "body",
      }),
    );
    expect(result).toEqual({ action: "ignored", reason: "unmapped-repo" });
  });

  it("files work from a 'Create Pilot work' message for the channel's default agent (PAT-2004)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const pilot = new FakePilot();
    const ack = makeAck();
    const withDefault: BridgeMapping = {
      ...mapping,
      channels: { [CHANNEL_ID]: { companyId: "co-1", name: "market-intel", defaultAgent: "christina" } },
    };
    const service = new BridgeService(config, withDefault, store as never, pilot as never, {
      uuid: () => "corr-work",
      sendAck: ack.sendAck,
    });

    // No mention at all: the channel decides who owns it.
    const result = await service.handleEvent(
      makeEvent({
        id: "4a".repeat(32),
        tags: [["h", CHANNEL_ID], ["t", "pilot-work"]],
        content: "Turn this into work: audit the ACME renewal terms.",
      }),
    );

    expect(result).toMatchObject({ action: "issue-created", issueId: "iss-1" });
    expect(pilot.created[0]?.assigneeAgentId).toBe("agent-1");
    expect(pilot.created[0]?.title).toContain("audit the ACME renewal terms");
    store.close();
  });

  it("refuses the menu action in a channel with no default agent", async () => {
    const { pilot, service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "4b".repeat(32),
        tags: [["h", CHANNEL_ID], ["t", "pilot-work"]],
        content: "file this",
      }),
    );
    expect(result).toEqual({ action: "ignored", reason: "no-default-agent" });
    expect(pilot.created).toHaveLength(0);
  });

  it("the menu action follows the same sender authorization as a mention", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const pilot = new FakePilot();
    const ack = makeAck();
    const withDefault: BridgeMapping = {
      ...mapping,
      channels: { [CHANNEL_ID]: { companyId: "co-1", name: "market-intel", defaultAgent: "christina" } },
    };
    const service = new BridgeService(config, withDefault, store as never, pilot as never, {
      uuid: () => "corr-work",
      sendAck: ack.sendAck,
    });

    const result = await service.handleEvent(
      makeEvent({
        id: "4c".repeat(32),
        pubkey: STRANGER_PUBKEY,
        tags: [["h", CHANNEL_ID], ["t", "pilot-work"]],
        content: "file this for me",
      }),
    );

    expect(result).toEqual({ action: "ignored", reason: "unauthorized-sender" });
    expect(pilot.created).toHaveLength(0);
    expect(store.listAudit()[0]?.action).toBe("unauthorized-sender");
    store.close();
  });

  it("an explicit mention still wins over the channel default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const pilot = new FakePilot();
    const ack = makeAck();
    const twoAgents: BridgeMapping = {
      channels: {
        [CHANNEL_ID]: { companyId: "co-1", name: "market-intel", defaultAgent: "christina" },
      },
      agents: {
        christina: {
          pilotAgentId: "agent-1",
          pubkey: AGENT_PUBKEY,
          allowedSenders: [BOSS_PUBKEY],
        },
        alex: {
          pilotAgentId: "agent-alex",
          pubkey: "e".repeat(64),
          allowedSenders: [BOSS_PUBKEY],
        },
      },
    };
    const service = new BridgeService(config, twoAgents, store as never, pilot as never, {
      uuid: () => "corr-work",
      sendAck: ack.sendAck,
    });

    const result = await service.handleEvent(
      makeEvent({
        id: "4d".repeat(32),
        tags: [["h", CHANNEL_ID], ["t", "pilot-work"], ["p", "e".repeat(64)]],
        content: "security review of the renewal terms",
      }),
    );

    expect(result).toMatchObject({ action: "issue-created" });
    expect(pilot.created[0]?.assigneeAgentId).toBe("agent-alex");
    store.close();
  });

  it("applies a Crew approval decision from a mapped manager (PAT-1999)", async () => {
    const { pilot, service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "d1".repeat(32),
        tags: [
          ["h", CHANNEL_ID],
          ["t", "pilot-decision"],
          ["approval", "11111111-1111-1111-1111-111111111111"],
          ["decision", "approve"],
        ],
        content: "Approved — the SLA clause checks out.",
      }),
    );

    expect(result).toEqual({
      action: "decision-applied",
      approvalId: "11111111-1111-1111-1111-111111111111",
      decision: "approve",
    });
    expect(pilot.decisions).toEqual([
      { approvalId: "11111111-1111-1111-1111-111111111111", decision: "approve", note: "Approved — the SLA clause checks out." },
    ]);
    // A decision is not work: no issue may be filed for it.
    expect(pilot.created).toHaveLength(0);
  });

  it("refuses a decision from a viewer and never applies it", async () => {
    const { pilot, service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "d2".repeat(32),
        pubkey: STRANGER_PUBKEY,
        tags: [
          ["h", CHANNEL_ID],
          ["t", "pilot-decision"],
          ["approval", "11111111-1111-1111-1111-111111111111"],
          ["decision", "approve"],
        ],
        content: "approved",
      }),
    );

    expect(result).toEqual({ action: "ignored", reason: "decider-lacks-role" });
    expect(pilot.decisions).toHaveLength(0);
  });

  it("refuses a replayed decision message", async () => {
    const { pilot, service } = makeService();
    const decision = makeEvent({
      id: "d3".repeat(32),
      tags: [
        ["h", CHANNEL_ID],
        ["t", "pilot-decision"],
        ["approval", "11111111-1111-1111-1111-111111111111"],
        ["decision", "approve"],
      ],
      content: "approved",
    });

    expect(await service.handleEvent(decision)).toMatchObject({ action: "decision-applied" });
    // The receipt store suppresses the replay before the protocol is reached.
    expect(await service.handleEvent(decision)).toEqual({ action: "ignored", reason: "duplicate" });
    expect(pilot.decisions).toHaveLength(1);
  });

  it("refuses a decision on an approval that already moved on", async () => {
    const { pilot, service } = makeService();
    pilot.approvalStatus = "approved";
    const result = await service.handleEvent(
      makeEvent({
        id: "d4".repeat(32),
        tags: [
          ["h", CHANNEL_ID],
          ["t", "pilot-decision"],
          ["approval", "11111111-1111-1111-1111-111111111111"],
          ["decision", "approve"],
        ],
        content: "approved",
      }),
    );

    expect(result).toEqual({ action: "ignored", reason: "approval-approved" });
    expect(pilot.decisions).toHaveLength(0);
  });

  it("refuses a rejection with no reason for the agent to act on", async () => {
    const { pilot, service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "d5".repeat(32),
        tags: [
          ["h", CHANNEL_ID],
          ["t", "pilot-decision"],
          ["approval", "11111111-1111-1111-1111-111111111111"],
          ["decision", "reject"],
        ],
        content: "   ",
      }),
    );

    expect(result).toEqual({ action: "ignored", reason: "missing-reason" });
    expect(pilot.decisions).toHaveLength(0);
  });

  it("ignores a decision marker with no approval tag", async () => {
    const { pilot, service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "d6".repeat(32),
        tags: [["h", CHANNEL_ID], ["t", "pilot-decision"], ["decision", "approve"]],
        content: "approved",
      }),
    );

    expect(result).toEqual({ action: "ignored", reason: "missing-approval-tag" });
    expect(pilot.decisions).toHaveLength(0);
  });

  it("still succeeds when the gateway ack fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const pilot = new FakePilot();
    const failingAck: AckSender = async () => {
      throw new Error("crew-cli exited non-zero");
    };
    const service = new BridgeService(config, mapping, store as never, pilot as never, {
      uuid: () => "corr-z",
      sendAck: failingAck,
    });
    const result = await service.handleEvent(makeEvent());
    expect(result).toMatchObject({ action: "issue-created" });
    store.close();
  });

  it("rewrites the description when the source message is edited before checkout", async () => {
    const { pilot, service } = makeService();
    const root = makeEvent();
    await service.handleEvent(root);

    const edit = makeEvent({
      id: "a1".repeat(32),
      kind: 40003,
      tags: [["h", CHANNEL_ID], ["e", root.id]],
      content: "Revised: compare five competitors instead of three.",
    });
    const result = await service.handleEvent(edit);

    expect(result).toEqual({ action: "edited", issueId: "iss-1", mode: "description" });
    expect(pilot.descriptionUpdates).toEqual([
      { issueId: "iss-1", description: "Revised: compare five competitors instead of three." },
    ]);
    expect(pilot.comments).toHaveLength(0);
  });

  it("appends a revision comment when the source is edited after checkout", async () => {
    const { pilot, service } = makeService();
    const root = makeEvent();
    await service.handleEvent(root);
    pilot.assigneeAgentId = "agent-1"; // agent picked the issue up

    const edit = makeEvent({
      id: "b2".repeat(32),
      kind: 40003,
      tags: [["h", CHANNEL_ID], ["e", root.id]],
      content: "Actually, hold the enterprise comparison.",
    });
    const result = await service.handleEvent(edit);

    expect(result).toEqual({ action: "edited", issueId: "iss-1", mode: "revision-comment" });
    expect(pilot.descriptionUpdates).toHaveLength(0);
    expect(pilot.comments[0]?.issueId).toBe("iss-1");
    expect(pilot.comments[0]?.bodyText).toContain("Source request was edited in Crew");
    expect(pilot.comments[0]?.bodyText).toContain("hold the enterprise comparison");
  });

  it("resolves an edit of a follow-up message to the same issue", async () => {
    const { pilot, service } = makeService();
    const root = makeEvent();
    await service.handleEvent(root);
    const followUp = makeEvent({
      id: "f".repeat(64),
      tags: [["h", CHANNEL_ID], ["e", root.id, "", "root"], ["p", AGENT_PUBKEY]],
      content: "Please add screenshots.",
    });
    await service.handleEvent(followUp);

    const edit = makeEvent({
      id: "c3".repeat(32),
      kind: 40003,
      tags: [["h", CHANNEL_ID], ["e", followUp.id]],
      content: "Please add screenshots and a pricing table.",
    });
    const result = await service.handleEvent(edit);
    expect(result).toMatchObject({ action: "edited", issueId: "iss-1" });
  });

  it("ignores an edit whose target message is not linked to an issue", async () => {
    const { service } = makeService();
    const result = await service.handleEvent(
      makeEvent({
        id: "d4".repeat(32),
        kind: 40003,
        tags: [["h", CHANNEL_ID], ["e", "9".repeat(64)]],
        content: "edited",
      }),
    );
    expect(result).toEqual({ action: "ignored", reason: "unlinked-message" });
  });

  it("rate-limits a sender past the per-window budget", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-svc-"));
    const store = new BridgeStore(join(dir, "db.sqlite"));
    const pilot = new FakePilot();
    const ack = makeAck();
    const tight = { ...config, rateLimit: { perWindow: 2, windowSeconds: 60 } };
    const service = new BridgeService(tight, mapping, store as never, pilot as never, {
      uuid: () => "corr-r",
      sendAck: ack.sendAck,
    });

    const first = await service.handleEvent(makeEvent({ id: "1".repeat(64) }));
    const second = await service.handleEvent(makeEvent({ id: "2".repeat(64) }));
    const third = await service.handleEvent(makeEvent({ id: "3".repeat(64) }));

    expect(first).toMatchObject({ action: "issue-created" });
    expect(second).toMatchObject({ action: "issue-created" });
    expect(third).toEqual({ action: "ignored", reason: "rate-limited" });
    expect(pilot.created).toHaveLength(2);
    store.close();
  });
});
