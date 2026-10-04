import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BridgeMapping } from "./crew.js";
import type { PilotClient } from "./pilot.js";
import {
  issueSnapshot,
  renderProjection,
  runProjection,
  sameSnapshot,
  type IssueSnapshot,
} from "./projection.js";
import { BridgeStore } from "./store.js";

const mapping: BridgeMapping = {
  channels: {},
  agents: {
    christina: { pilotAgentId: "agent-1", pubkey: "a".repeat(64), allowedSenders: [] },
    alex: { pilotAgentId: "agent-alex", pubkey: "b".repeat(64), allowedSenders: [] },
  },
};

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "bridge-proj-"));
  return new BridgeStore(join(dir, "db.sqlite"));
}

function seedLink(store: BridgeStore) {
  store.linkThread("root-1", "ch-1", "iss-1", "https://pilot.test/co-1/issues/iss-1", "co-1");
}

class FakePilot {
  issue: {
    id: string;
    status?: string;
    assigneeAgentId?: string | null;
    children?: Array<{ id: string; status?: string; assigneeAgentId?: string | null }>;
  } = { id: "iss-1", status: "In Progress", assigneeAgentId: "agent-1" };

  async getIssue(id: string) {
    return { ...this.issue, id };
  }
}

function nameOf(agentId: string | null): string | null {
  if (!agentId) return null;
  for (const [name, agent] of Object.entries(mapping.agents)) {
    if (agent.pilotAgentId === agentId) return name;
  }
  return agentId.slice(0, 8);
}

describe("projection snapshots (PAT-2002)", () => {
  it("treats a never-projected thread as changed", () => {
    expect(sameSnapshot(null, issueSnapshot({ status: "Todo" }))).toBe(false);
  });

  it("detects a status change", () => {
    const a = issueSnapshot({ status: "Todo", assigneeAgentId: "agent-1" });
    const b = issueSnapshot({ status: "In Progress", assigneeAgentId: "agent-1" });
    expect(sameSnapshot(a, b)).toBe(false);
  });

  it("detects an owner change", () => {
    const a = issueSnapshot({ status: "Todo", assigneeAgentId: "agent-1" });
    const b = issueSnapshot({ status: "Todo", assigneeAgentId: "agent-alex" });
    expect(sameSnapshot(a, b)).toBe(false);
  });

  it("detects a child-work change even when the parent is unchanged", () => {
    const base = { status: "In Progress", assigneeAgentId: "agent-1" };
    const a = issueSnapshot({ ...base, children: [{ id: "c1", status: "Todo" }] });
    const b = issueSnapshot({ ...base, children: [{ id: "c1", status: "Done" }] });
    expect(sameSnapshot(a, b)).toBe(false);
  });

  it("is stable across identical snapshots", () => {
    const s = issueSnapshot({
      status: "In Progress",
      assigneeAgentId: "agent-1",
      children: [{ id: "c1", status: "Done", assigneeAgentId: "agent-alex" }],
    });
    expect(sameSnapshot(s, issueSnapshot(s))).toBe(true);
  });
});

describe("renderProjection", () => {
  it("says what the board says, and never that a review passed", () => {
    const snapshot: IssueSnapshot = {
      status: "In Progress",
      assigneeAgentId: "agent-1",
      children: [
        { id: "cccccccc-1111", status: "Done", assigneeAgentId: "agent-alex" },
        { id: "dddddddd-2222", status: "In Progress", assigneeAgentId: "agent-1" },
      ],
    };
    const text = renderProjection(snapshot, "https://pilot.test/co-1/issues/iss-1", nameOf);
    expect(text).toContain("**In Progress** — assigned to christina");
    expect(text).toContain("Child work: 1/2 complete.");
    expect(text).toContain("`cccccccc` Done — alex");
    expect(text).toContain("Board: https://pilot.test/co-1/issues/iss-1");
    expect(text).not.toMatch(/review (passed|approved)/i);
  });

  it("omits the child section when there is no child work", () => {
    const text = renderProjection(
      { status: "Todo", assigneeAgentId: null, children: [] },
      "https://pilot.test/co-1/issues/iss-1",
      nameOf,
    );
    expect(text).not.toContain("Child work:");
    expect(text).toContain("**Todo**");
  });
});

describe("runProjection", () => {
  it("posts once, then stays silent while the tree is unchanged", async () => {
    const store = makeStore();
    seedLink(store);
    const pilot = new FakePilot();
    const posted: string[] = [];

    const deps = {
      mapping,
      store,
      pilot: pilot as unknown as PilotClient,
      agentName: nameOf,
      post: async (_ch: string, _root: string, text: string) => {
        posted.push(text);
      },
    };

    const first = await runProjection(deps);
    expect(first).toHaveLength(1);
    expect(posted).toHaveLength(1);

    const second = await runProjection(deps);
    expect(second).toHaveLength(0);
    expect(posted).toHaveLength(1);

    // The work tree moves → exactly one more projection.
    pilot.issue = { id: "iss-1", status: "Done", assigneeAgentId: "agent-1" };
    const third = await runProjection(deps);
    expect(third).toHaveLength(1);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toContain("**Done**");
    store.close();
  });

  it("does not save the snapshot when the post fails, so it retries", async () => {
    const store = makeStore();
    seedLink(store);
    const pilot = new FakePilot();

    await expect(
      runProjection({
        mapping,
        store,
        pilot: pilot as unknown as PilotClient,
        post: async () => {
          throw new Error("crew-cli exited non-zero");
        },
      }),
    ).rejects.toThrow("crew-cli exited non-zero");

    expect(store.projectionSnapshot("root-1")).toBeNull();
    store.close();
  });
});
