import express, { type Express } from "express";

export type HealthState = {
  startedAt: string;
  eventsHandled: number;
  issuesCreated: number;
  commentsPosted: number;
  lastEventAt: string | null;
};

export function createHealthApp(state: HealthState): Express {
  const app = express();
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, ...state });
  });
  return app;
}
