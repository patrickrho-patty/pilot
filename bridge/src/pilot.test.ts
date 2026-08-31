import { afterAll, describe, expect, it, vi } from "vitest";
import { PilotClient, pilotIssueUrl } from "./pilot.js";

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
});
