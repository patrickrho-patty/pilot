import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotClient } from "./pilot.js";

type Subset = {
  info?: { version?: string };
  paths: Record<string, Record<string, unknown>>;
};

const subset: Subset = JSON.parse(
  readFileSync(fileURLToPath(new URL("../contracts/pilot-openapi-subset.json", import.meta.url)), "utf8"),
);

/** Turn a spec template ("/api/issues/{id}/comments") into a matcher. */
function templateToRegex(template: string): RegExp {
  const escaped = template
    .split("/")
    .map((seg) =>
      /^\{.*\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

function findTemplate(path: string, method: string): string | null {
  for (const [template, ops] of Object.entries(subset.paths)) {
    if (!(method.toLowerCase() in ops)) continue;
    if (templateToRegex(template).test(path)) return template;
  }
  return null;
}

const calls: Array<{ method: string; path: string }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), path });
    // Plausible bodies for the methods that parse a response.
    if (path.endsWith("/skills")) return new Response(JSON.stringify({ id: "s1", slug: "s" }), { status: 200 });
    if (path.endsWith("/comments")) return new Response(JSON.stringify([]), { status: 200 });
    if (path.endsWith("/issues")) return new Response(JSON.stringify({ id: "iss1", companyId: "co1" }), { status: 200 });
    return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = new PilotClient("https://pilot.test", "pak_test");

/** Drive every method the bridge calls in production. */
async function exerciseAll(): Promise<void> {
  await client.whoami();
  await client.createIssue({ companyId: "co1", title: "t", description: "d", idempotencyKey: "k" });
  await client.addIssueComment("iss1", "hello");
  await client.checkoutIssue("iss1");
  await client.createCompanySkill({ companyId: "co1", name: "n", markdown: "m" });
  await client.createSecret({ companyId: "co1", name: "n", key: "K", value: "v" });
  await client.updateAgentEnv("ag1", { A: "b" });
  await client.removeAgentEnvKeys("ag1", ["A"]);
  await client.syncAgentSkills("ag1", ["k"], "add");
}

describe("Pilot API contract (PAT-1978)", () => {
  it("pins a spec captured from the live deployment", () => {
    expect(subset.info?.version).toBeTruthy();
    expect(Object.keys(subset.paths).length).toBeGreaterThan(0);
  });

  it("every path the client calls exists in the pinned spec with that method", async () => {
    await exerciseAll();
    expect(calls.length).toBeGreaterThan(0);

    const unmatched = calls.filter((c) => !findTemplate(c.path, c.method));
    expect(unmatched).toEqual([]);
  });

  it("the checkout contract documents its failure codes", () => {
    const checkout = subset.paths["/api/issues/{id}/checkout"]?.post as
      | { responses?: Record<string, unknown> }
      | undefined;
    expect(checkout).toBeDefined();
    const codes = Object.keys(checkout?.responses ?? {});
    // 409 is enforced by the server (issues route) even though the published
    // spec omits it; the client handles it explicitly.
    expect(codes).toContain("200");
    expect(codes).toContain("403");
  });
});
