import express, { Router, type ErrorRequestHandler } from "express";
import type { Db } from "@pilotai/db";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";
import { connectionWorkspaceService, type ConnectionWorkspaceOptions } from "../services/connection-workspaces.js";
import { connectionExecutionService } from "../services/connection-execution.js";
import { GmailMutationUncertain } from "../services/connection-gmail-write.js";

/** Private service bridge, deliberately independent from native Pilot work/subscription identity. */
export function connectionWorkspaceRoutes(db: Db, options: ConnectionWorkspaceOptions = {}) {
  const router = Router();
  const service = connectionWorkspaceService(db, options);
  const execution = connectionExecutionService(db, options);
  router.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    next();
  });
  router.use(express.json({ limit: "32kb", strict: true }));
  router.post("/:bindingId/manage", async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, "Invalid request");
      res.json(await service.manage(String(req.params.bindingId), req.body));
    } catch (error) {
      next(error);
    }
  });
  router.post("/:bindingId/oauth-complete", async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, "Invalid request");
      res.json(await service.complete(String(req.params.bindingId), req.body));
    } catch (error) {
      next(error);
    }
  });
  router.post("/:bindingId/catalog", async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, "Invalid request");
      res.json(await execution.catalog(String(req.params.bindingId), req.body));
    } catch (error) { next(error); }
  });
  router.post("/:bindingId/prepare", async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, "Invalid request");
      res.json(await execution.prepare(String(req.params.bindingId), req.body));
    } catch (error) { next(error); }
  });
  router.post("/:bindingId/execute", async (req, res, next) => {
    try {
      if (Object.keys(req.query).length) throw new HttpError(400, "Invalid request");
      res.json(await execution.execute(String(req.params.bindingId), req.body));
    } catch (error) { next(error); }
  });
  router.use((_req, res) => {
    res.status(404).json({ error: "Connection route unavailable" });
  });
  // Terminate all failures here, before generic request logging or telemetry can retain bodies.
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : (error as { type?: string })?.type === "entity.too.large"
            ? 413
            : error instanceof SyntaxError
              ? 400
              : 503;
    res.status(status).json({ error: status >= 500 ? "Connection service unavailable" : "Connection request denied", ...(error instanceof GmailMutationUncertain ? { code: "gmail_mutation_uncertain" } : {}) });
  };
  router.use(errorHandler);
  return router;
}
