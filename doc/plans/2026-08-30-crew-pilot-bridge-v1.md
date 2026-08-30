# Crew–Pilot Bridge V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Mode-A loop from `doc/CREW_INTEGRATION.md` for real: a Crew mention of a hired virtual employee creates/annotates a Pilot issue, and the employee replies in the Crew thread as itself; hiring an employee in Pilot provisions their full Crew presence (profile, enrollment, channels, #welcome intro).

**Decision context:** Patty-internal deployment first (both systems already live: `crew.patty.io` + `pilot.patty.io` on rho-cluster). The client-deployment packaging in the field guide is a later phase, not this plan.

**Architecture:** A standalone TypeScript service (`bridge/`) in the pilot monorepo, deployed to the `pilot` namespace on rho-cluster. It authenticates to the Crew relay with a dedicated gateway identity (NIP-42), subscribes to stream messages (kind 40002) that mention managed agent pubkeys, correlates Crew thread roots ↔ Pilot issues in a local SQLite store, and drives Pilot's REST API with a scoped agent API key (Bearer). Provisioning (mint npub → publish kind:0 profile → enroll via relay admin → join channels → #welcome intro) is a `bridge hire` subcommand; deprovisioning (`bridge offboard`) mirrors it. Agent replies are signed by each agent's own key via `crew-cli`, with `CREW_*` env injected from Pilot secret bindings at heartbeat launch. Sender authorization (original guide §67 P0 + §97): a mention only triggers work when the sender is in the agent's `allowedSenders` list (manager + direct teammates, mirrored from the Pilot org into `mapping.json`).

**Tech Stack:** Node 20+, TypeScript, pnpm workspace package, `nostr-tools` (relay WS, NIP-42, event signing/verification), `better-sqlite3` (bridge-local correlation store — deliberate deviation: the bridge store is disposable infrastructure state, not product data; Pilot remains the source of truth per the plan's source-of-truth matrix), `vitest` (repo standard), Express (health endpoint only).

## Global Constraints

- Pilot repo, branch `main`, remote `pilot` (patty-io/pilot). All commits `git commit -s`.
- Live endpoints: relay `wss://crew.patty.io`, Pilot API `https://pilot.patty.io` (pilot namespace, rho-cluster, acct `361645878435`, ap-northeast-2).
- Crew event kind for stream messages: `40002` (`KIND_STREAM_MESSAGE_V2`, `crates/crew-core/src/kind.rs:481`). Mentions appear as `p` tags (hex pubkey).
- Relay requires NIP-42 auth for subscriptions; filters MUST include `kinds` (p-gate, AGENTS.md).
- Never log private keys. Never put agent keys in the gateway's conversation path (doc §96).
- Enrollment uses `crew-admin` AddMember (kind 9030, NIP-43) signed by the relay admin key — the relay identity key, held by the operator (currently `~/griddle-backups/griddle-identity-key.txt`). The bridge invokes crew-admin as a subprocess; it does not implement NIP-43 itself.
- Agent replies go through `crew-cli` (`crew messages send --channel <uuid> --content <text> --reply-to <root-event-id>`), env: `CREW_RELAY_URL=wss://crew.patty.io`, `CREW_PRIVATE_KEY=<agent hex>`, `CREW_AUTH_TAG=<nip-oa tag>`.
- Follow pilot repo conventions: TypeScript ESM (`.js` import specifiers), vitest, biome formatting.

---

### Task 1: Scaffold the `bridge/` package

**Files:**
- Create: `bridge/package.json`
- Create: `bridge/tsconfig.json`
- Create: `bridge/src/config.ts`
- Create: `bridge/src/config.test.ts`
- Modify: `pnpm-workspace.yaml` (add `bridge` to packages)

**Interfaces:**
- Produces: `loadConfig(): BridgeConfig` where
  `BridgeConfig = { relayUrl: string; pilotBaseUrl: string; pilotApiKey: string; gatewayPrivateKey: string; dbPath: string; port: number; admin: { crewCliPath: string; relayAdminKeyEnv: string } }`
  — every later task imports this.

- [ ] **Step 1: Add workspace entry and package files**

`pnpm-workspace.yaml` — add to `packages:` list:
```yaml
  - bridge
```

`bridge/package.json`:
```json
{
  "name": "@pilotai/crew-bridge",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.19.0",
    "nostr-tools": "^2.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`bridge/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing config test**

`bridge/src/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const BASE = {
  CREW_RELAY_URL: "wss://crew.patty.io",
  PILOT_BASE_URL: "https://pilot.patty.io",
  PILOT_API_KEY: "pak_test",
  CREW_GATEWAY_PRIVATE_KEY: "a".repeat(64),
};

describe("loadConfig", () => {
  it("reads required vars", () => {
    const cfg = loadConfig(BASE, "/tmp/bridge.db");
    expect(cfg.relayUrl).toBe("wss://crew.patty.io");
    expect(cfg.pilotBaseUrl).toBe("https://pilot.patty.io");
    expect(cfg.pilotApiKey).toBe("pak_test");
    expect(cfg.gatewayPrivateKey).toBe("a".repeat(64));
    expect(cfg.port).toBe(3101);
  });

  it("rejects a short private key", () => {
    expect(() =>
      loadConfig({ ...BASE, CREW_GATEWAY_PRIVATE_KEY: "short" }, "/tmp/b.db"),
    ).toThrow(/CREW_GATEWAY_PRIVATE_KEY/);
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `cd bridge && pnpm vitest run`
Expected: FAIL — `loadConfig` not exported.

- [ ] **Step 4: Implement `bridge/src/config.ts`**

```ts
export type BridgeConfig = {
  relayUrl: string;
  pilotBaseUrl: string;
  pilotApiKey: string;
  gatewayPrivateKey: string;
  dbPath: string;
  port: number;
  admin: { crewCliPath: string; relayAdminKeyPath: string };
};

export function loadConfig(
  env: Record<string, string | undefined>,
  dbPathFallback = "./bridge.db",
): BridgeConfig {
  const req = (name: string): string => {
    const v = env[name];
    if (!v || v.length === 0) throw new Error(`Missing env ${name}`);
    return v;
  };
  const gatewayPrivateKey = req("CREW_GATEWAY_PRIVATE_KEY");
  if (!/^[0-9a-f]{64}$/i.test(gatewayPrivateKey)) {
    throw new Error("CREW_GATEWAY_PRIVATE_KEY must be 64 hex chars");
  }
  return {
    relayUrl: req("CREW_RELAY_URL"),
    pilotBaseUrl: req("PILOT_BASE_URL").replace(/\/$/, ""),
    pilotApiKey: req("PILOT_API_KEY"),
    gatewayPrivateKey,
    dbPath: env["BRIDGE_DB_PATH"] ?? dbPathFallback,
    port: Number(env["BRIDGE_PORT"] ?? "3101"),
    admin: {
      crewCliPath: env["CREW_CLI_PATH"] ?? "crew",
      relayAdminKeyPath: req("CREW_RELAY_ADMIN_KEY_PATH"),
    },
  };
}
```

- [ ] **Step 5: Run tests, expect pass**

Run: `cd bridge && pnpm vitest run`
Expected: 2 PASS.

- [ ] **Step 6: Install deps and commit**

```bash
pnpm install
git add pnpm-workspace.yaml bridge
git commit -s -m "feat(bridge): scaffold crew-bridge package with env config"
```

---

### Task 2: Pilot API client

**Files:**
- Create: `bridge/src/pilot.ts`
- Create: `bridge/src/pilot.test.ts`

**Interfaces:**
- Consumes: `BridgeConfig.pilotBaseUrl`, `.pilotApiKey` (Task 1).
- Produces:
  - `class PilotClient { constructor(baseUrl: string, apiKey: string); createIssue(input: {companyId: string; title: string; description: string; assigneeAgentId?: string}): Promise<{id: string; url: string}>; addIssueComment(issueId: string, body: string): Promise<void>; }`
  - `pilotIssueUrl(baseUrl, companyId, issueId): string`
  - **Contract pinning is part of this task:** confirm exact paths/field names against the live OpenAPI before finalizing (Step 1). If the live schema differs, adapt THIS file only — later tasks depend on the method signatures above, not the wire shape.

- [ ] **Step 1: Pin the live contract**

Run:
```bash
curl -s https://pilot.patty.io/api/openapi.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in sorted(d['paths']):
    if 'issue' in p and 'post' in d['paths'][p]: print('POST', p)
    if 'issue' in p and 'get' in d['paths'][p]: print('GET ', p)
" | head -n 20
```
Expected: the company-scoped issue creation path (e.g. `/api/companies/{companyId}/issues`) and comment path (e.g. `/api/issues/{issueId}/comments`). Also:
```bash
curl -s https://pilot.patty.io/api/openapi.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
ref=d['paths'][list(d['paths'])[0]]
print(list(d['paths'].keys())[:5])
"
```
Use the output to fill the exact path constants and required body fields in Step 3. Record them in `bridge/src/pilot.ts` as `const ISSUE_CREATE_PATH = ...` etc.

- [ ] **Step 2: Write the failing test**

`bridge/src/pilot.test.ts`:
```ts
import { afterAll, describe, expect, it, vi } from "vitest";
import { PilotClient, pilotIssueUrl } from "./pilot.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("PilotClient", () => {
  it("creates an issue with bearer auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "iss_1", companyId: "co_1" }), { status: 201 }),
    );
    const client = new PilotClient("https://pilot.patty.io", "pak_test");
    const issue = await client.createIssue({
      companyId: "co_1",
      title: "Competitive intel on ACME",
      description: "From #market-intel: https://crew.patty.io",
    });
    expect(issue.id).toBe("iss_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/issues");
    expect(init.headers["Authorization"]).toBe("Bearer pak_test");
    expect(JSON.parse(init.body).title).toBe("Competitive intel on ACME");
  });

  it("throws with status and body on error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const client = new PilotClient("https://pilot.patty.io", "pak_bad");
    await expect(
      client.createIssue({ companyId: "co_1", title: "t", description: "d" }),
    ).rejects.toThrow(/403/);
  });

  it("builds board URLs", () => {
    expect(pilotIssueUrl("https://pilot.patty.io", "co_1", "iss_1")).toBe(
      "https://pilot.patty.io/co_1/issues/iss_1",
    );
  });
});
```

- [ ] **Step 3: Implement `bridge/src/pilot.ts`**

```ts
const ISSUE_CREATE_PATH = "/api/companies/{companyId}/issues"; // pin from Step 1
const ISSUE_COMMENT_PATH = "/api/issues/{issueId}/comments"; // pin from Step 1

export function pilotIssueUrl(baseUrl: string, companyId: string, issueId: string) {
  return `${baseUrl}/${companyId}/issues/${issueId}`;
}

type Params = Record<string, string>;

export class PilotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call(path: string, init: RequestInit): Promise<Response> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...((init.headers as Params) ?? {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Pilot API ${resp.status} on ${path}: ${body.slice(0, 200)}`);
    }
    return resp;
  }

  async createIssue(input: {
    companyId: string;
    title: string;
    description: string;
    assigneeAgentId?: string;
  }): Promise<{ id: string; url: string }> {
    const path = ISSUE_CREATE_PATH.replace("{companyId}", input.companyId);
    const resp = await this.call(path, {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        ...(input.assigneeAgentId ? { assigneeAgentId: input.assigneeAgentId } : {}),
      }),
    });
    const body = (await resp.json()) as { id: string; companyId?: string };
    const companyId = body.companyId ?? input.companyId;
    return { id: body.id, url: pilotIssueUrl(this.baseUrl, companyId, body.id) };
  }

  async addIssueComment(issueId: string, bodyText: string): Promise<void> {
    const path = ISSUE_COMMENT_PATH.replace("{issueId}", issueId);
    await this.call(path, { method: "POST", body: JSON.stringify({ body: bodyText }) });
  }
}
```

- [ ] **Step 4: Run tests, expect pass; adjust paths per Step 1 findings**

Run: `cd bridge && pnpm vitest run`
Expected: 3 PASS. (Update `ISSUE_CREATE_PATH`/`ISSUE_COMMENT_PATH` and the URL builder if the live API differs from the defaults above.)

- [ ] **Step 5: Commit**

```bash
git add bridge/src/pilot.ts bridge/src/pilot.test.ts
git commit -s -m "feat(bridge): Pilot REST client with pinned live contracts"
```

---

### Task 3: Relay client (NIP-42 + subscription)

**Files:**
- Create: `bridge/src/relay.ts`
- Create: `bridge/src/relay.test.ts`

**Interfaces:**
- Consumes: `BridgeConfig.relayUrl`, `.gatewayPrivateKey` (Task 1).
- Produces:
  - `class CrewRelay { constructor(relayUrl: string, privateKey: string); subscribe(filter: {kinds: number[]; "#p": string[]}, onEvent: (event: NostrEvent) => void): Promise<void>; close(): Promise<void>; }`
  - `verifyCrewEvent(event: NostrEvent): boolean` — id/sig check.
  - Reconnect with backoff is internal (1s → 30s cap).

- [ ] **Step 1: Write the failing test**

`bridge/src/relay.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { verifyCrewEvent } from "./relay.js";

describe("verifyCrewEvent", () => {
  it("accepts a valid signed event", () => {
    const sk = generateSecretKey();
    const event = finalizeEvent({ kind: 40002, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" }, sk);
    expect(verifyCrewEvent(event)).toBe(true);
  });

  it("rejects a tampered event", () => {
    const sk = generateSecretKey();
    const event = finalizeEvent({ kind: 40002, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" }, sk);
    expect(verifyCrewEvent({ ...event, content: "tampered" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure; implement `bridge/src/relay.ts`**

```ts
import { finalizeEvent, type Event as NostrEvent, verifyEvent } from "nostr-tools";
import { Relay } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";

export type { NostrEvent };

export function verifyCrewEvent(event: NostrEvent): boolean {
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

export class CrewRelay {
  #relay: Awaited<ReturnType<typeof Relay.connect>> | null = null;
  #backoffMs = 1000;

  constructor(
    private readonly relayUrl: string,
    private readonly privateKey: string,
  ) {}

  async subscribe(
    filter: { kinds: number[]; "#p": string[] },
    onEvent: (event: NostrEvent) => void,
  ): Promise<void> {
    const connect = async () => {
      this.#relay = await Relay.connect(this.relayUrl);
      this.#backoffMs = 1000;
      // NIP-42: authenticate when the relay challenges; nostr-tools Relay
      // handles the challenge hook below.
      this.#relay.on("auth", async (challenge: string) => {
        const authEvent = finalizeEvent(
          { kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["challenge", challenge], ["relay", this.relayUrl]], content: "" },
          // nostr-tools accepts Uint8Array or hex via nip19; keep hex → bytes:
          hexToBytes(this.privateKey),
        );
        return authEvent;
      });
      this.#relay.subscribe([{ ...filter, since: Math.floor(Date.now() / 1000) }], {
        onevent: (event: NostrEvent) => {
          if (verifyCrewEvent(event)) onEvent(event);
        },
        onclose: () => {
          setTimeout(() => void connect().catch(() => {}), this.#backoffMs);
          this.#backoffMs = Math.min(this.#backoffMs * 2, 30_000);
        },
      });
    };
    await connect();
  }

  async publish(event: NostrEvent): Promise<void> {
    if (!this.#relay) throw new Error("relay not connected");
    await this.#relay.publish(event);
  }

  async close(): Promise<void> {
    this.#relay?.close();
  }
}
```

Note: check `nostr-tools@2` exports at implementation time — if `Relay.connect` auth hook differs (some versions expose `relay.auth`), adapt inside this file only; the public surface stays. `@noble/hashes/utils.js` is a transitive dep of nostr-tools; if the import path differs in the pinned version, keep a local `hexToBytes` helper instead.

- [ ] **Step 3: Run tests, expect pass; commit**

Run: `cd bridge && pnpm vitest run` → 2 PASS.
```bash
git add bridge/src/relay.ts bridge/src/relay.test.ts
git commit -s -m "feat(bridge): NIP-42 relay client with signed-event verification and reconnect"
```

---

### Task 4: Mentions, dedupe, correlation store

**Files:**
- Create: `bridge/src/mentions.ts`, `bridge/src/mentions.test.ts`
- Create: `bridge/src/store.ts`, `bridge/src/store.test.ts`

**Interfaces:**
- Produces:
  - `parseMentionTargets(event: NostrEvent): string[]` — lowercase hex pubkeys from `p` tags.
  - `threadRootOf(event: NostrEvent): string` — root `e` tag marker `root` if present, else event.id.
  - `class BridgeStore { constructor(dbPath: string); seen(eventId: string): boolean; markSeen(eventId: string): void; linkThread(threadRoot: string, crewChannelId: string, issueId: string, issueUrl: string, companyId: string): void; issueForThread(threadRoot: string): {issueId: string; issueUrl: string; companyId: string} | null; close(): void; }`

- [ ] **Step 1: Failing tests**

`bridge/src/mentions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseMentionTargets, threadRootOf } from "./mentions.js";

const ev = (tags: string[][]) => ({ tags } as never);

describe("mentions", () => {
  it("extracts p-tag pubkeys", () => {
    expect(parseMentionTargets(ev([["p", "ABC"], ["p", "dd"], ["t", "x"]]))).toEqual(["abc", "dd"]);
  });
  it("uses root marker when present", () => {
    expect(threadRootOf(ev([["e", "aaa", "", "root"], ["e", "bbb"]]))).toBe("aaa");
  });
  it("falls back to event id", () => {
    expect(threadRootOf({ tags: [], id: "xyz" } as never)).toBe("xyz");
  });
});
```

`bridge/src/store.test.ts`:
```ts
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BridgeStore } from "./store.js";

describe("BridgeStore", () => {
  it("dedupes event ids and correlates threads", () => {
    const dir = mkdtempSync("/tmp/bridge-test-");
    const store = new BridgeStore(`${dir}/db.sqlite`);
    expect(store.seen("e1")).toBe(false);
    store.markSeen("e1");
    expect(store.seen("e1")).toBe(true);
    store.linkThread("root1", "ch1", "iss1", "https://pilot.patty.io/co/issues/iss1", "co");
    expect(store.issueForThread("root1")?.issueId).toBe("iss1");
    store.close();
  });
});
```

- [ ] **Step 2: Implement both modules**

`bridge/src/mentions.ts`:
```ts
import type { NostrEvent } from "./relay.js";

export function parseMentionTargets(event: NostrEvent): string[] {
  const out = new Set<string>();
  for (const [tag, value] of event.tags) {
    if (tag === "p" && typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value)) {
      out.add(value.toLowerCase());
    }
  }
  return [...out];
}

export function threadRootOf(event: NostrEvent): string {
  for (const [tag, id, _, marker] of event.tags) {
    if (tag === "e" && marker === "root" && typeof id === "string") return id;
  }
  return event.id;
}
```

`bridge/src/store.ts`:
```ts
import Database from "better-sqlite3";

export class BridgeStore {
  #db: Database.Database;

  constructor(dbPath: string) {
    this.#db = new Database(dbPath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS seen_events (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS thread_issue (
        thread_root TEXT PRIMARY KEY,
        crew_channel_id TEXT NOT NULL,
        issue_id TEXT NOT NULL,
        issue_url TEXT NOT NULL,
        company_id TEXT NOT NULL
      );
    `);
  }

  #hasSeen = () => this.#db.prepare("SELECT 1 FROM seen_events WHERE id = ?");
  #insertSeen = () => this.#db.prepare("INSERT INTO seen_events (id) VALUES (?)");

  seen(eventId: string): boolean {
    return this.#hasSeen().get(eventId) !== undefined;
  }

  markSeen(eventId: string): void {
    this.#insertSeen().run(eventId);
  }

  #link = () => this.#db.prepare(
    "INSERT OR REPLACE INTO thread_issue (thread_root, crew_channel_id, issue_id, issue_url, company_id) VALUES (?, ?, ?, ?, ?)",
  );
  #lookup = () => this.#db.prepare(
    "SELECT issue_id, issue_url, company_id FROM thread_issue WHERE thread_root = ?",
  );

  linkThread(threadRoot: string, crewChannelId: string, issueId: string, issueUrl: string, companyId: string): void {
    this.#link().run(threadRoot, crewChannelId, issueId, issueUrl, companyId);
  }

  issueForThread(threadRoot: string): { issueId: string; issueUrl: string; companyId: string } | null {
    const row = this.#lookup().get(threadRoot) as
      | { issue_id: string; issue_url: string; company_id: string }
      | undefined;
    return row
      ? { issueId: row.issue_id, issueUrl: row.issue_url, companyId: row.company_id }
      : null;
  }

  close(): void {
    this.#db.close();
  }
}
```

- [ ] **Step 3: Run tests, expect pass; commit**

Run: `cd bridge && pnpm vitest run` → 5 PASS.
```bash
git add bridge/src/mentions.ts bridge/src/mentions.test.ts bridge/src/store.ts bridge/src/store.test.ts
git commit -s -m "feat(bridge): mention parsing, event dedupe, thread-issue correlation store"
```

---

### Task 5: Gateway identity + channel UUID resolution

**Files:**
- Create: `bridge/src/crew.ts`, `bridge/src/crew.test.ts`

**Interfaces:**
- Consumes: `BridgeConfig.admin.crewCliPath` (Task 1).
- Produces:
  - `runCrewCli(cliPath: string, args: string[], env: Record<string, string>): Promise<{ok: boolean; stdout: string}>` — spawn wrapper, redacts env from errors.
  - `sendGatewayAck(cliPath: string, env: Record<string, string>, channelUuid: string, replyTo: string, text: string): Promise<void>` — posts as the **gateway** identity:
    `crew messages send --channel <uuid> --reply-to <root> --content <text>` with `CREW_RELAY_URL`/`CREW_PRIVATE_KEY` = gateway key from config.
  - `lookupChannelUuid(cliPath: string, env: Record<string, string>, channelName: string): Promise<string | null>` — via `crew --format compact channels list` JSON.
  - Channel→company mapping file `bridge/mapping.json`: `{ "channels": { "<channelNameOrUuid>": {"companyId": "..."} }, "agents": { "<agentName>": {"pilotAgentId": "...", "pubkey": "..."} } }` — loaded by `loadMapping(path)`.

- [ ] **Step 1: Failing test (spawn mocked)**

`bridge/src/crew.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { parseChannelList } from "./crew.js";

describe("parseChannelList", () => {
  it("finds a channel uuid by name from compact JSON", () => {
    const out = JSON.stringify([{ id: "c-1", name: "market-intel" }, { id: "c-2", name: "general" }]);
    expect(parseChannelList(out, "market-intel")).toBe("c-1");
    expect(parseChannelList(out, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `bridge/src/crew.ts`**

```ts
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

export function runCrewCli(
  cliPath: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(cliPath, args, {
      env: { ...process.env, ...env },
      timeout: 30_000,
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.on("close", (code) => resolve({ ok: code === 0, stdout }));
    child.on("error", () => resolve({ ok: false, stdout: "" }));
  });
}

export async function sendGatewayAck(
  cliPath: string,
  env: Record<string, string>,
  channelUuid: string,
  replyTo: string,
  text: string,
): Promise<void> {
  const res = await runCrewCli(cliPath, ["messages", "send", "--channel", channelUuid, "--reply-to", replyTo, "--content", text], env);
  if (!res.ok) throw new Error(`gateway ack failed: crew-cli exited non-zero`);
}

export function parseChannelList(stdout: string, channelName: string): string | null {
  try {
    const rows = JSON.parse(stdout) as Array<{ id: string; name: string }>;
    return rows.find((r) => r.name === channelName)?.id ?? null;
  } catch {
    return null;
  }
}

export async function lookupChannelUuid(
  cliPath: string,
  env: Record<string, string>,
  channelName: string,
): Promise<string | null> {
  const res = await runCrewCli(cliPath, ["--format", "compact", "channels", "list"], env);
  return parseChannelList(res.stdout, channelName);
}

export type BridgeMapping = {
  channels: Record<string, { companyId: string; name: string }>;
  agents: Record<
    string,
    { pilotAgentId: string; pubkey: string; allowedSenders: string[] }
  >;
};

export function loadMapping(path: string): BridgeMapping {
  return JSON.parse(readFileSync(path, "utf8")) as BridgeMapping;
}
```

Mapping entries are keyed by channel **uuid**; `name` is the human label used in issue copy. `allowedSenders` holds lowercase hex pubkeys (manager + direct teammates) mirrored from the Pilot org — the §67-P0/§97 authorization gate.

- [ ] **Step 3: Run tests, expect pass; commit**

Run: `cd bridge && pnpm vitest run` → 6 PASS.
```bash
git add bridge/src/crew.ts bridge/src/crew.test.ts
git commit -s -m "feat(bridge): crew-cli invocation, gateway acks, mapping config"
```

---

### Task 6: The service loop

**Files:**
- Create: `bridge/src/index.ts`
- Create: `bridge/src/loop.ts`, `bridge/src/loop.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `handleEvent(deps, event): Promise<HandleResult>` where `HandleResult = "skip" | "created" | "commented"`, pure and unit-tested; `index.ts` wires config/relay/store/pilot and starts an Express health endpoint on `cfg.port` (`GET /healthz` → `{ok:true}`).

- [ ] **Step 1: Failing test for the decision logic**

`bridge/src/loop.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { handleEvent } from "./loop.js";

const mkDeps = () => ({
  store: {
    seen: vi.fn().mockReturnValue(false),
    markSeen: vi.fn(),
    issueForThread: vi.fn().mockReturnValue(null),
    linkThread: vi.fn(),
  },
  pilot: {
    createIssue: vi.fn().mockResolvedValue({ id: "iss9", url: "https://pilot.patty.io/co/issues/iss9" }),
    addIssueComment: vi.fn().mockResolvedValue(undefined),
  },
  mapping: {
    channels: { "ch-market-intel": { companyId: "co_1", name: "market-intel" } },
    agents: { christina: { pilotAgentId: "ag_1", pubkey: "a".repeat(64), allowedSenders: ["human1"] } },
  },
  channelKeyFor: vi.fn().mockReturnValue("ch-market-intel"),
  authorName: vi.fn().mockReturnValue("patrick"),
  notifyThread: vi.fn().mockResolvedValue(undefined),
});

describe("handleEvent", () => {
  it("creates an issue for a first mention and acks the thread", async () => {
    const deps = mkDeps();
    const event = {
      id: "ev1", pubkey: "human1",
      tags: [["p", "a".repeat(64)], ["e", "ev1", "", "root"]],
      content: "@christina pull intel on ACME",
    } as never;
    const result = await handleEvent(deps, event);
    expect(result).toBe("created");
    expect(deps.pilot.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co_1", assigneeAgentId: "ag_1" }),
    );
    expect(deps.store.linkThread).toHaveBeenCalledWith("ev1", expect.anything(), "iss9", expect.anything(), "co_1");
    expect(deps.notifyThread).toHaveBeenCalled();
  });

  it("skips an unauthorized sender (§67-P0 authorization gate)", async () => {
    const deps = mkDeps();
    const event = {
      id: "ev3", pubkey: "stranger".padEnd(64, "0"),
      tags: [["p", "a".repeat(64)], ["e", "ev3", "", "root"]],
      content: "@christina pull intel",
    } as never;
    expect(await handleEvent(deps, event)).toBe("skip");
    expect(deps.pilot.createIssue).not.toHaveBeenCalled();
  });

  it("comments instead of creating when the thread is already linked", async () => {
    const deps = mkDeps();
    deps.store.issueForThread.mockReturnValue({ issueId: "iss1", issueUrl: "u", companyId: "co_1" });
    const event = {
      id: "ev2", pubkey: "human1",
      tags: [["p", "a".repeat(64)], ["e", "ev1", "", "root"]],
      content: "also check their pricing page",
    } as never;
    const result = await handleEvent(deps, event);
    expect(result).toBe("commented");
    expect(deps.pilot.addIssueComment).toHaveBeenCalledWith("iss1", expect.stringContaining("pricing"));
    expect(deps.pilot.createIssue).not.toHaveBeenCalled();
  });

  it("skips duplicate events", async () => {
    const deps = mkDeps();
    deps.store.seen.mockReturnValue(true);
    const event = { id: "ev1", pubkey: "h", tags: [], content: "x" } as never;
    expect(await handleEvent(deps, event)).toBe("skip");
  });
});
```

- [ ] **Step 2: Implement `bridge/src/loop.ts`**

```ts
import type { NostrEvent } from "./relay.js";
import { threadRootOf } from "./mentions.js";
import { parseMentionTargets } from "./mentions.js";
import type { BridgeStore } from "./store.js";
import type { PilotClient } from "./pilot.js";
import type { BridgeMapping } from "./crew.js";

export type LoopDeps = {
  store: Pick<BridgeStore, "seen" | "markSeen" | "issueForThread" | "linkThread">;
  pilot: Pick<PilotClient, "createIssue" | "addIssueComment">;
  mapping: BridgeMapping;
  channelKeyFor(event: NostrEvent): string | null;
  authorName(event: NostrEvent): string;
  notifyThread(event: NostrEvent, text: string): Promise<void>;
};

export type HandleResult = "skip" | "created" | "commented";

export async function handleEvent(deps: LoopDeps, event: NostrEvent): Promise<HandleResult> {
  if (deps.store.seen(event.id)) return "skip";
  deps.store.markSeen(event.id);

  const channelKey = deps.channelKeyFor(event);
  const channelMap = channelKey ? deps.mapping.channels[channelKey] : undefined;
  if (!channelKey || !channelMap) return "skip";

  const mentioned = Object.entries(deps.mapping.agents).filter(([, v]) =>
    parseMentionTargets(event).includes(v.pubkey),
  );
  if (mentioned.length === 0) return "skip";

  // §67-P0 / §97 authorization gate: only allowlisted senders assign work.
  const sender = event.pubkey.toLowerCase();
  const authorized = mentioned.some(([, v]) => v.allowedSenders.includes(sender));
  if (!authorized) return "skip";

  const threadRoot = threadRootOf(event);
  const existing = deps.store.issueForThread(threadRoot);
  const author = deps.authorName(event);

  if (existing) {
    await deps.pilot.addIssueComment(
      existing.issueId,
      `Follow-up from **${author}** in the Crew thread:\n\n> ${event.content}`,
    );
    return "commented";
  }

  const primary = mentioned[0][1];
  const issue = await deps.pilot.createIssue({
    companyId: channelMap.companyId,
    title: event.content.slice(0, 80) || `Crew request from ${author}`,
    description: `From Crew #${channelMap.name} by **${author}**.\n\n> ${event.content}\n\nThread root: \`${threadRoot}\``,
    assigneeAgentId: primary.pilotAgentId,
  });
  deps.store.linkThread(threadRoot, channelKey, issue.id, issue.url, channelMap.companyId);
  await deps.notifyThread(event, `Created [${issue.id}](${issue.url}) in Pilot for ${mentioned[0][0]} — work tracked there.`);
  return "created";
}
```

- [ ] **Step 3: Implement `bridge/src/index.ts` wiring**

```ts
import express from "express";
import { loadConfig } from "./config.js";
import { CrewRelay, type NostrEvent } from "./relay.js";
import { BridgeStore } from "./store.js";
import { PilotClient } from "./pilot.js";
import { loadMapping, sendGatewayAck } from "./crew.js";
import { threadRootOf } from "./mentions.js";
import { handleEvent } from "./loop.js";
import { bytesToHex, getPublicKey } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";

const cfg = loadConfig(process.env);
const store = new BridgeStore(cfg.dbPath);
const pilot = new PilotClient(cfg.pilotBaseUrl, cfg.pilotApiKey);
const mapping = loadMapping(process.env["BRIDGE_MAPPING_PATH"] ?? "bridge/mapping.json");
// crew-cli speaks HTTPS to the relay's REST surface; the WS client speaks WSS.
const cliRelayUrl = cfg.relayUrl.replace("wss://", "https://");
const gatewayEnv = { CREW_RELAY_URL: cliRelayUrl, CREW_PRIVATE_KEY: cfg.gatewayPrivateKey };
const channelKeyByUuid = new Map(Object.keys(mapping.channels).map((k) => [k, k]));

const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.listen(cfg.port, () => console.info(`crew-bridge health on :${cfg.port}`));

const subscribedPubkeys = [
  ...new Set([
    bytesToHex(getPublicKey(hexToBytes(cfg.gatewayPrivateKey))), // gateway identity (acks)
    ...Object.values(mapping.agents).map((a) => a.pubkey), // hired employees
  ]),
];

const relay = new CrewRelay(cfg.relayUrl, cfg.gatewayPrivateKey);
await relay.subscribe(
  { kinds: [40002], "#p": subscribedPubkeys },
  async (event: NostrEvent) => {
    try {
      await handleEvent(
        {
          store, pilot, mapping,
          // Channel resolution: the event carries the channel uuid in its
          // h-tag (NIP-29) or `channel` marker; mapping.json keys channels by uuid.
          channelKeyFor: (ev) => {
            for (const [tag, value] of ev.tags) {
              if ((tag === "h" || tag === "channel") && typeof value === "string" && channelKeyByUuid.has(value)) {
                return value;
              }
            }
            return null;
          },
          authorName: (ev) => ev.pubkey.slice(0, 8),
          notifyThread: (ev, text) => {
            const channelUuid = channelKeyForEvent(ev, mapping);
            return channelUuid
              ? sendGatewayAck(cfg.admin.crewCliPath, { ...gatewayEnv }, channelUuid, threadRootOf(ev), text)
              : Promise.resolve();
          },
        },
        event,
      );
    } catch (err) {
      console.error("handleEvent failed", err);
    }
  },
);

function channelKeyForEvent(ev: NostrEvent, m: typeof mapping): string | null {
  for (const [tag, value] of ev.tags) {
    if ((tag === "h" || tag === "channel") && typeof value === "string" && m.channels[value]) return value;
  }
  return null;
}
```

`loop.ts` stays pure (all lookups injected); `index.ts` owns live lookups. If the pinned relay build tags channel messages differently (verify once in Task 9 Step 3 with `crew --format compact messages get`), adjust only `channelKeyForEvent`.

- [ ] **Step 4: Run all tests, expect pass; commit**

Run: `cd bridge && pnpm vitest run` → all PASS.
```bash
git add bridge/src/index.ts bridge/src/loop.ts bridge/src/loop.test.ts
git commit -s -m "feat(bridge): event loop — mention to Pilot issue with thread correlation"
```

---

### Task 7: `bridge hire` — employee provisioning

**Files:**
- Create: `bridge/src/hire.ts`, `bridge/src/hire.test.ts`
- Modify: `bridge/src/index.ts` (CLI dispatch: `bridge hire <name>`)

**Interfaces:**
- Produces: `provisionEmployee(input: {name: string; displayName: string; role: string; avatarUrl?: string; crewChannelUuids: string[]; relayUrl: string}): Promise<{pubkey: string}>`:
  1. `generateSecretKey()` → npub (hex) — print ONCE to stdout for the operator to file in Pilot secrets (`CREW_PRIVATE_KEY` binding).
  2. Publish kind:0 profile `{"name","display_name","role","picture"}` signed with the new key via `relay.publish`.
  3. Enroll: subprocess `crew-admin members add <hex> member` with env `CREW_RELAY_URL` + `CREW_RELAY_PRIVATE_KEY` read from `cfg.admin.relayAdminKeyPath` file contents.
  4. Join channels: `crew-cli` per channel with the NEW agent key env — `crew channels join <uuid>` (or NIP-29 join via `crew-admin` if CLI lacks join — pin at implementation).
  5. Post #welcome intro as the gateway identity via `sendGatewayAck`.

**Crew Team assembly is deliberately NOT in this task.** `KIND_TEAM` (30176) teams group
*personas*, not raw pubkeys — proper Team assembly means also minting a `KIND_PERSONA` per
employee and is a fast follow once the V1 loop is accepted. V1 employees are already fully
mentionable (p-tag addressing + profile) without a Team.
- Test: unit-test the profile-event builder (`buildProfileEvent`) pure function; the full command is exercised live in Task 9.

- [ ] **Step 1: Failing test**

```ts
// bridge/src/hire.test.ts
import { describe, expect, it } from "vitest";
import { buildProfileEvent } from "./hire.js";

describe("buildProfileEvent", () => {
  it("builds a kind:0 with role and name", () => {
    const ev = buildProfileEvent("a".repeat(64), { name: "christina", displayName: "Christina", role: "Market Intel", avatarUrl: "https://x/y.png" });
    expect(ev.kind).toBe(0);
    const content = JSON.parse(ev.content);
    expect(content.name).toBe("christina");
    expect(content.role).toBe("Market Intel");
    expect(ev.pubkey).toBe("a".repeat(64));
  });
});
```

- [ ] **Step 2: Implement `bridge/src/hire.ts`** — `buildProfileEvent` signs with the passed pubkey's secret via `finalizeEvent({kind:0, ...}, hexToBytes(skHex))`; then the `provisionEmployee` orchestration calling relay.publish, `runCrewCli`-style subprocess for `crew-admin members add`, channel joins, and `sendGatewayAck` for the intro. Wire `bridge hire <name> --role ... --channels a,b` into `index.ts` CLI dispatch (`process.argv`).

- [ ] **Step 3: Run tests; commit**

```bash
git add bridge/src/hire.ts bridge/src/hire.test.ts bridge/src/index.ts
git commit -s -m "feat(bridge): hire command — mint npub, profile, enrollment, channel joins, welcome intro"
```

---

### Task 7b: `bridge offboard <name>` — deprovisioning

**Files:**
- Create: `bridge/src/offboard.ts`, `bridge/src/offboard.test.ts`
- Modify: `bridge/src/index.ts` (CLI dispatch)

**Interfaces:**
- Produces: `deprovisionEmployee(input: {pubkey: string; channelUuids: string[]}): Promise<void>`:
  1. Leave channels: `crew-admin` `RemoveMember` per channel (same relay-admin-key subprocess pattern as hire).
  2. Tombstone profile: publish kind:0 with `{..., "status": "offboarded"}` signed by the agent key — read from the Pilot secret binding, never printed (operator passes `CREW_AGENT_KEY_FILE` env pointing at a file; if the binding is not retrievable server-side, this step degrades to enrollment revocation + a gateway-signed farewell note, recorded in the run output).
  3. Revocation note: gateway ack is NOT posted to channels (an offboard is quiet); instead write one structured log line with the pubkey + timestamp for the audit trail.
- Test: unit-test the tombstone profile builder (kind:0, `status: "offboarded"`, preserves `name`).

- [ ] **Step 1: Failing test** (mirror `hire.test.ts` shape; assert tombstone content merge).
- [ ] **Step 2: Implement** following the hire pattern (subprocess + relay.publish).
- [ ] **Step 3: Run tests; commit** `git commit -s -m "feat(bridge): offboard command — channel leaves, tombstone profile, revocation"`.

---

### Task 8: Agent self-reply wiring (secrets + skill)

**Files:**
- Modify: `bridge/mapping.json` (add hired agent entries)
- Create: `bridge/CREW_AGENT_SKILL.md` — instructions shipped into the hired agent's Pilot skill set:

```markdown
# Crew channel duty
You are an employee of this company and a member of Crew channels.
When Pilot assigns you an issue that originated from Crew (description contains a
thread root), you MUST reply in that thread as yourself:

    crew messages send --channel <CHANNEL_UUID> --reply-to <THREAD_ROOT_ID> \
      --content "<your reply; progress updates on start, result summary when done>"

Env CREW_RELAY_URL, CREW_PRIVATE_KEY, CREW_AUTH_TAG are already set in your runtime.
Post at least one progress message when you start and one final summary when the
issue reaches a terminal state.
```

- [ ] **Step 1:** For the Task-9 pilot agent, create the Pilot secret bindings `CREW_PRIVATE_KEY` / `CREW_AUTH_TAG` via the Pilot secrets UI or API (pin the exact endpoint from `server/src/routes/` secrets surface during execution; the operator files the minted key from Task 7).
- [ ] **Step 2:** Attach `CREW_AGENT_SKILL.md` to the agent's skills in Pilot (built-in agent config or company skill), and ensure the chosen adapter's runtime image includes the `crew` binary (the `agent-runtime-images.yml` workflow builds runtime images — add `crew-cli` install if absent).
- [ ] **Step 3:** Verify heartbeat launch inherits the env: run the agent once from the Pilot board and confirm `crew messages get` works from inside the runtime (operator-checked).
- [ ] **Step 4:** Commit the skill file: `git commit -s -m "feat(bridge): crew channel duty skill for hired employees"`.

---

### Task 9: Live end-to-end acceptance (crew.patty.io + pilot.patty.io)

**No new files.** This task is the acceptance gate.

- [ ] **Step 1:** Configure `bridge/mapping.json` with the real company id, the `#market-intel` channel uuid (via `crew --format compact channels list`), and the hired agent from Task 7.
- [ ] **Step 2:** Build and start locally: `pnpm --filter @pilotai/crew-bridge build && BRIDGE_DB_PATH=/tmp/bridge.db PILOT_BASE_URL=https://pilot.patty.io CREW_RELAY_URL=wss://crew.patty.io PILOT_API_KEY=<agent api key> CREW_GATEWAY_PRIVATE_KEY=<hex> CREW_RELAY_ADMIN_KEY_PATH=~/griddle-backups/griddle-identity-key.txt node bridge/dist/index.js`
- [ ] **Step 3:** From the Crew desktop app, post in `#market-intel`: `@<hired-agent-name> pull the latest competitive intel on ACME` (sender must be in the agent's `allowedSenders`; also verify a non-allowlisted account mentioning the agent is skipped — check the bridge log line).
- [ ] **Step 4:** Assert in Pilot board: issue created, title/description present, assigned to the hired agent. Assert in Crew: gateway ack reply in-thread. Assert trigger of the agent heartbeat: the hired agent posts a progress message in-thread **as itself** (distinct pubkey), then a final summary.
- [ ] **Step 5:** Follow-up check: post another message in the same thread → same Pilot issue gains a comment (no new issue).
- [ ] **Step 6:** Offboard check: run `bridge offboard <name>` → agent's channel memberships gone (verify via `crew-admin`/members list), tombstone profile visible, and a post in-thread mention is skipped by the bridge (agent key revoked path) — record remaining Pilot-side termination steps in the §98 checklist.
- [ ] **Step 7:** Record results in `doc/CREW_INTEGRATION.md` §98 checklist; commit: `git commit -s -m "docs: record crew-pilot bridge V1 acceptance results"`.

---

### Task 10: Deploy the bridge to rho-cluster

**Files:**
- Create: `bridge/Dockerfile`
- Modify: `.github/workflows/ecr-build-deploy.yml` (add a bridge job or matrix entry), `deploy/rho-eks.yaml` (bridge Deployment + Secret refs)

- [ ] **Step 1:** `bridge/Dockerfile` — node:20-alpine, `pnpm --filter @pilotai/crew-bridge --prod deploy`, CMD `node dist/index.js`.
- [ ] **Step 2:** Mirror the existing pilot build/deploy job: build → `361645878435.dkr.ecr.ap-northeast-2.amazonaws.com/crew-bridge:<tag>` → `helm upgrade --install` with the bridge Deployment (env from k8s Secret `crew-bridge`: `CREW_GATEWAY_PRIVATE_KEY`, `PILOT_API_KEY`; `CREW_RELAY_ADMIN_KEY_PATH` mounted from a Secret only used by `bridge hire` jobs, not the long-running loop).
- [ ] **Step 3:** Verify `https://pilot.patty.io` unaffected; bridge pod `Running`, `GET /healthz` via port-forward.
- [ ] **Step 4:** Commit: `git commit -s -m "feat(bridge): container image and rho-cluster deployment"`.

---

### Task 11: Publish the integration flag to the relay

**Files:**
- Create: `bridge/src/integration.ts`, `bridge/src/integration.test.ts`
- Modify: `bridge/src/index.ts` (call once at startup after successful Pilot validation)

**Interfaces:**
- Produces: `publishIntegrationFlag(cfg): Promise<void>` — publishes community metadata (kind
  39000 extension or dedicated tag per the pinned relay build) adding:

```json
{ "pilot_integration": { "board_url": "https://pilot.patty.io", "status": "connected" } }
```

Signed with the relay-admin key (`cfg.admin.relayAdminKeyPath`) via a `crew-admin` subprocess
fallback if direct event construction is not exposed. Crew desktops read this at startup and
flip into pilot mode (§101/§103 of `doc/CREW_INTEGRATION.md`).

- [ ] **Step 1:** Failing test — metadata merge logic (preserve existing 39000 fields).
- [ ] **Step 2:** Implement; call at startup only when Pilot validation succeeds.
- [ ] **Step 3:** Run tests; commit `git commit -s -m "feat(bridge): publish pilot_integration flag to relay"`.

---

### Task 12: Crew-side pilot mode (cross-repo; patty-io/crew)

**Not a bridge file.** Tracked here because V1 acceptance depends on it:

- [ ] **Step 1:** Desktop reads `pilot_integration` from community metadata at startup.
- [ ] **Step 2:** Agents section renders **"Your team"**: pilot-provisioned employees as read-only
  cards ("Managed in Pilot" badge; card action = open `${board_url}` deep-link). "New agent"
  replaced by "Hire an employee" → board. Local creation hidden while the flag is present
  (`agents.creation` policy, guide §101). Flag absent → unchanged standalone behavior.
- [ ] **Step 3:** Accept in the live app: with the flag present, `@hire`-flow agents appear as
  read-only; without it, nothing changes.
- [ ] **Step 4:** Commit in the crew repo: `git commit -s -m "feat(agents): pilot-integration mode from community metadata"`.

---

### Task 13 (post-acceptance): Office-awareness digest

**Files:**
- Create: `bridge/src/digest.ts`, `bridge/src/digest.test.ts`

Scheduled command: pull channel activity since the previous cursor (`store` table), format a
digest, and file it as the mapped employee's routine input (Pilot routine trigger), so the
employee wakes, exercises judgment, and may reply/escalate/propose (guide Part XXII). Governed by
`mapping.json` per-agent quiet hours + `maxProactivePerDay`. Ship **after** Task 9 acceptance;
V1 ships without it.

---

## Roadmap notes (not V1)

- **V2 admin UI:** Crew → Workspace admin → Integrations → Pilot (URL + service key +
  validate/connect), relay-backed community config; replaces the operator-level env/file setup
  (guide §103/§105). Sales-required before external self-hosted customers.
- **V2 bundling:** bridge ships inside the customer deployment package (helm/compose) as a
  self-configuring component (guide §104).
- **SSO:** shared OIDC IdP (Keycloak) so board deep-links authenticate with the same human
  identity (guide §105).
