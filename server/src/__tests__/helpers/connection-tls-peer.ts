import https from "node:https";
import { execFileSync } from "node:child_process";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { connectionDirectFetch } from "../../services/connection-direct-tls.js";

/** Explicit fixture-only transport reset, distinct from an HTTP error response. */
export class ConnectionTlsDisconnect extends Error {}

/** Disposable verified TLS peer; synthetic certificate/key remain in memory. */
export async function connectionTlsPeer(handler: typeof fetch) {
  const pem = execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "/dev/stdout",
      "-out",
      "/dev/stdout",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const old = getCACertificates();
  setDefaultCACertificates([...old, pem]);
  let calls = 0;
  const server = https.createServer(
    { cert: pem, key: pem },
    async (req, res) => {
      calls++;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const original = req.headers["x-fixture-origin"];
        if (typeof original !== "string")
          throw new Error("fixture origin absent");
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers))
          if (
            typeof value === "string" &&
            key !== "host" &&
            key !== "x-fixture-origin"
          )
            headers.set(key, value);
        const body = Buffer.concat(chunks).toString();
        const response = await handler(original, {
          method: req.method,
          headers,
          ...(body ? { body } : {}),
        });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        if (error instanceof ConnectionTlsDisconnect) {
          res.destroy();
          return;
        }
        res.writeHead(500);
        res.end();
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  const fetch: typeof globalThis.fetch = (url, init) =>
    connectionDirectFetch(origin + new URL(String(url)).pathname, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        "x-fixture-origin": String(url),
      },
    });
  return {
    fetch,
    calls: () => calls,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      setDefaultCACertificates(old);
    },
  };
}
