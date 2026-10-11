import { Agent, request } from "node:https";

/** Explicit direct TLS: ambient proxy configuration and global dispatchers never participate. */
export const connectionDirectFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw new Error("Connection transport denied");
  const body = init.body == null ? undefined : String(init.body);
  if (body && Buffer.byteLength(body) > 65_536) throw new Error("Connection transport denied");
  const agent = new Agent({ keepAlive: false, rejectUnauthorized: true, proxyEnv: {} });
  return new Promise<Response>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      agent.destroy();
      reject(new Error("Connection transport unavailable"));
    };
    const req = request(
      url,
      {
        agent,
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        signal: init.signal ?? undefined,
      },
      (res) => {
        const status = res.statusCode ?? 502;
        if (status < 200 || status > 599 || (status >= 300 && status < 400)) {
          fail();
          return;
        }
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65_536) {
            fail();
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", fail);
        res.on("aborted", fail);
        res.on("end", () => {
          if (settled) return;
          let response: Response;
          try {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
            }
            response = new Response([204, 205].includes(status) ? null : Buffer.concat(chunks), { status, headers });
          } catch {
            fail();
            return;
          }
          settled = true;
          clearTimeout(timer);
          agent.destroy();
          resolve(response);
        });
      },
    );
    const timer = setTimeout(fail, 5_000);
    req.on("error", fail);
    req.end(body);
  });
};
