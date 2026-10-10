import https from "node:https";
import http from "node:http";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connectionDirectFetch } from "../services/connection-direct-tls.js";
let dir: string,
  server: ReturnType<typeof https.createServer>,
  proxy: ReturnType<typeof http.createServer>,
  url: string,
  proxyCalls = 0;
const trust = getCACertificates(),
  globalAgent = https.globalAgent;
let mode = "ok",
  received = "";
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "connections-tls-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      path.join(dir, "key.pem"),
      "-out",
      path.join(dir, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(path.join(dir, "cert.pem"), "utf8");
  setDefaultCACertificates([...trust, cert]);
  server = https.createServer({ cert, key: readFileSync(path.join(dir, "key.pem")) }, (req, res) => {
    req.on("data", (c) => (received += c.toString()));
    req.on("end", () => {
      if (mode === "redirect") {
        res.writeHead(302, { location: "https://evil.test" });
        res.end();
      } else if (mode === "large") {
        res.end("x".repeat(65537));
      } else if (mode === "stall") {
        res.writeHead(200);
        res.write("{");
      } else {
        res.end('{"ok":true}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `https://127.0.0.1:${(server.address() as { port: number }).port}/private`;
  proxy = http.createServer((_req, res) => {
    proxyCalls++;
    res.end("proxy");
  });
  proxy.on("connect", (_req, socket) => {
    proxyCalls++;
    socket.destroy();
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
  vi.stubEnv("HTTPS_PROXY", proxyUrl);
  vi.stubEnv("NODE_USE_ENV_PROXY", "1");
  https.globalAgent = new https.Agent({ proxyEnv: { HTTPS_PROXY: proxyUrl } });
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ambient dispatcher must not run"));
});
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  https.globalAgent.destroy();
  https.globalAgent = globalAgent;
  setDefaultCACertificates(trust);
  server.closeAllConnections();
  proxy.closeAllConnections();
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => proxy.close(() => r())),
  ]);
  rmSync(dir, { recursive: true, force: true });
});
it("uses verified direct TLS despite ambient proxy and global dispatcher", async () => {
  mode = "ok";
  const r = await connectionDirectFetch(url, { method: "POST", body: "ephemeral-capability" });
  expect(await r.json()).toEqual({ ok: true });
  expect(received).toBe("ephemeral-capability");
  expect(proxyCalls).toBe(0);
});
it("rejects redirects and oversized streaming responses", async () => {
  for (const m of ["redirect", "large"]) {
    mode = m;
    await expect(connectionDirectFetch(url)).rejects.toThrow();
  }
  expect(proxyCalls).toBe(0);
});
it("bounds an unfinished response body by the same deadline", async () => {
  mode = "stall";
  const start = Date.now();
  await expect(connectionDirectFetch(url)).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(6500);
});
it("refuses an untrusted server certificate", async () => {
  mode = "ok";
  setDefaultCACertificates(trust);
  await expect(connectionDirectFetch(url)).rejects.toThrow();
});
