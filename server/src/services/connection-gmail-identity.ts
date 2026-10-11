import { z } from "zod";
import { forbidden } from "../errors.js";
import { connectionDirectFetch } from "./connection-direct-tls.js";

export const GMAIL_ACCOUNT_ISSUER = "https://gmail.googleapis.com";

/** Read only the authenticated mailbox identity; no messages or extra OAuth scopes. */
export async function verifyConnectionGmailIdentity(
  token: string,
  fetcher: typeof fetch = connectionDirectFetch,
) {
  const denied = () =>
    forbidden("Gmail account identity could not be verified");
  try {
    if (!token || token.length > 32768 || /\s/.test(token)) throw denied();
    const response = await fetcher(
      `${GMAIL_ACCOUNT_ISSUER}/gmail/v1/users/me/profile?fields=emailAddress`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw denied();
    const body = await response.text();
    if (Buffer.byteLength(body) > 4096) throw denied();
    const { emailAddress } = z
      .object({ emailAddress: z.email().max(254) })
      .parse(JSON.parse(body));
    return {
      issuer: GMAIL_ACCOUNT_ISSUER,
      subject: emailAddress.toLowerCase(),
    };
  } catch {
    throw denied();
  }
}
