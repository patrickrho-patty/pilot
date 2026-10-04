import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bump, createHealthApp, type HealthState } from "./health.js";

describe("health endpoint", () => {
  const state: HealthState = {
    startedAt: "2026-08-31T00:00:00.000Z",
    eventsHandled: 7,
    issuesCreated: 3,
    commentsPosted: 4,
    lastEventAt: "2026-08-31T12:00:00.000Z",
    relayConnected: true,
    pilotReachable: true,
    counters: new Map(),
    dlq: () => [],
  };
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createHealthApp(state);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );

  it("reports ok with counters", async () => {
    const resp = await fetch(`${baseUrl}/healthz`);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({ ok: true, eventsHandled: 7 });
  });

  it("exposes the §55 metric set as Prometheus text", async () => {
    bump(state, "crew_pilot_events_processed_total", { result: "issue-created" });
    const resp = await fetch(`${baseUrl}/metrics`);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toContain('crew_pilot_events_processed_total{result="issue-created"} 1');
    expect(text).toContain("crew_pilot_dlq_depth 0");
    expect(text).toContain("crew_pilot_oldest_dlq_age_seconds 0");
    expect(text).toContain("crew_pilot_relay_connected 1");
    expect(text).toContain("crew_pilot_pilot_reachable 1");
  });

  it("counts dlq depth and age of the oldest pending dead letter", async () => {
    const old = new Date(Date.now() - 120_000).toISOString();
    const fresh: HealthState = {
      ...state,
      dlq: () => [
        {
          eventId: "e1",
          channelId: "ch1",
          threadRoot: null,
          senderPubkey: null,
          targetMapping: null,
          failureClass: "auth",
          attemptCount: 1,
          firstAttemptAt: old,
          lastAttemptAt: old,
          diagnostic: "401",
          replayStatus: "pending",
        },
      ],
    };
    const app = createHealthApp(fresh);
    const srv = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const addr = srv.address();
    if (addr === null || typeof addr === "string") throw new Error("no port");
    const text = await (await fetch(`http://127.0.0.1:${addr.port}/metrics`)).text();
    expect(text).toContain("crew_pilot_dlq_depth 1");
    const age = Number(/crew_pilot_oldest_dlq_age_seconds (\d+)/.exec(text)?.[1]);
    expect(age).toBeGreaterThanOrEqual(119);
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

  it("404s other paths", async () => {
    const resp = await fetch(`${baseUrl}/nope`);
    expect(resp.status).toBe(404);
  });
});
