import express, { type Express } from "express";
import type { DlqEntry } from "./store.js";

export type HealthState = {
  startedAt: string;
  eventsHandled: number;
  issuesCreated: number;
  commentsPosted: number;
  lastEventAt: string | null;
  /** Relay connection state, surfaced as a health flag. */
  relayConnected: boolean;
  /** Pilot reachability, surfaced as a health flag. */
  pilotReachable: boolean;
  /**
   * §55 counters. Keys are `name{label="value",...}` so rendering is a sort
   * and a join — no metric registry needed for this size of surface.
   */
  counters: Map<string, number>;
  /** Dead letters awaiting replay, for depth + age gauges. */
  dlq: () => DlqEntry[];
};

export function bump(state: HealthState, name: string, labels: Record<string, string> = {}): void {
  const labelText = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  const key = labelText ? `${name}{${labelText}}` : name;
  state.counters.set(key, (state.counters.get(key) ?? 0) + 1);
}

export function createHealthApp(state: HealthState): Express {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, ...state, counters: undefined, dlq: undefined });
  });

  // §55 gateway metric set, Prometheus text exposition.
  app.get("/metrics", (_req, res) => {
    const lines: string[] = [];
    for (const [key, value] of [...state.counters.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`${key} ${value}`);
    }

    const pending = state.dlq().filter((e) => e.replayStatus === "pending");
    lines.push(`crew_pilot_dlq_depth ${pending.length}`);
    const oldest = pending[0]?.firstAttemptAt;
    const ageSeconds = oldest
      ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest)) / 1000))
      : 0;
    lines.push(`crew_pilot_oldest_dlq_age_seconds ${ageSeconds}`);
    lines.push(`crew_pilot_relay_connected ${state.relayConnected ? 1 : 0}`);
    lines.push(`crew_pilot_pilot_reachable ${state.pilotReachable ? 1 : 0}`);

    res.type("text/plain; version=0.0.4").send(`${lines.join("\n")}\n`);
  });

  return app;
}
