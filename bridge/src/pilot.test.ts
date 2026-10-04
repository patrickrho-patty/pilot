import { afterAll, describe, expect, it, vi } from "vitest";
import { PilotClient, pilotIssueUrl, scopeCoversProjects } from "./pilot.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("PilotClient", () => {
  it("creates an issue with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "iss_1", companyId: "co_1" }), {
        status: 201,
      }),
    );
    const client = new PilotClient("https://pilot.patty.io", "pak_test");
    const issue = await client.createIssue({
      companyId: "co_1",
      title: "Competitive intel on ACME",
      description: "From #market-intel: https://crew.patty.io",
      assigneeAgentId: "ag_7",
    });
    expect(issue.id).toBe("iss_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/companies/co_1/issues");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer pak_test",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      title: "Competitive intel on ACME",
      assigneeAgentId: "ag_7",
    });
  });

  it("throws with status and body on error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const client = new PilotClient("https://pilot.patty.io", "pak_bad");
    await expect(
      client.createIssue({ companyId: "co_1", title: "t", description: "d" }),
    ).rejects.toThrow(/403/);
  });

  it("posts issue comments", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));
    const client = new PilotClient("https://pilot.patty.io", "pak_test");
    await client.addIssueComment("iss_1", "Crew follow-up");
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toBe("https://pilot.patty.io/api/issues/iss_1/comments");
    expect(JSON.parse(String((init as RequestInit).body)).body).toBe(
      "Crew follow-up",
    );
  });

  it("builds board URLs", () => {
    expect(pilotIssueUrl("https://pilot.patty.io", "co_1", "iss_1")).toBe(
      "https://pilot.patty.io/co_1/issues/iss_1",
    );
  });

  it("sends projectId, goalId and idempotencyKey when supplied", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "iss_2", companyId: "co_1" }), { status: 201 }),
    );
    const client = new PilotClient("https://pilot.patty.io", "pak_test");
    await client.createIssue({
      companyId: "co_1",
      title: "t",
      description: "d",
      projectId: "11111111-1111-1111-1111-111111111111",
      goalId: "22222222-2222-2222-2222-222222222222",
      idempotencyKey: "corr-1",
    });
    const body = JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));
    expect(body).toMatchObject({
      projectId: "11111111-1111-1111-1111-111111111111",
      goalId: "22222222-2222-2222-2222-222222222222",
      idempotencyKey: "corr-1",
    });
  });

  it("reports a paused project as a distinct checkout outcome, not a failure", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Project is paused because its budget hard-stop was reached" }), {
        status: 409,
      }),
    );
    const client = new PilotClient("https://pilot.patty.io", "pak_test");
    await expect(client.checkoutIssue("iss_1")).resolves.toEqual({
      ok: false,
      reason: "project-paused",
      message: "Project is paused because its budget hard-stop was reached",
    });
  });
});

describe("scopeCoversProjects (PAT-1992)", () => {
  const P1 = "11111111-1111-1111-1111-111111111111";
  const P2 = "22222222-2222-2222-2222-222222222222";

  it("rejects a broad standard key", () => {
    const r = scopeCoversProjects({ kind: "standard" }, [P1]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain("task_bridge");
  });

  it("accepts a task_bridge key covering every mapped project", () => {
    expect(scopeCoversProjects({ kind: "task_bridge", projectIds: [P1, P2] }, [P1, P2])).toEqual({
      ok: true,
    });
    expect(scopeCoversProjects({ kind: "task_bridge", projectId: P1 }, [P1])).toEqual({ ok: true });
  });

  it("rejects a key that does not cover a mapped project", () => {
    const r = scopeCoversProjects({ kind: "task_bridge", projectIds: [P1] }, [P1, P2]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain(P2);
  });

  it("rejects a missing scope rather than assuming least privilege", () => {
    expect(scopeCoversProjects(undefined, []).ok).toBe(false);
  });
});
