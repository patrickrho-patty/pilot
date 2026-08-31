import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHealthApp, type HealthState } from "./health.js";

describe("health endpoint", () => {
  const state: HealthState = {
    startedAt: "2026-08-31T00:00:00.000Z",
    eventsHandled: 7,
    issuesCreated: 3,
    commentsPosted: 4,
    lastEventAt: "2026-08-31T12:00:00.000Z",
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
    expect(await resp.json()).toEqual({ ok: true, ...state });
  });

  it("404s other paths", async () => {
    const resp = await fetch(`${baseUrl}/nope`);
    expect(resp.status).toBe(404);
  });
});
