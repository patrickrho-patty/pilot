import { createHash } from "node:crypto";
import { finalizeEvent, verifyEvent, type Event as NostrEvent } from "nostr-tools";
import { Relay } from "nostr-tools";

export type { NostrEvent };

/**
 * NIP-01 id = sha256 of [0, pubkey, created_at, kind, tags, content].
 * nostr-tools verifyEvent checks the signature against the stored id but does
 * NOT recompute the id, so we enforce both halves ourselves.
 */
function eventIdFor(event: NostrEvent): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return createHash("sha256").update(serialized).digest("hex");
}

export function verifyCrewEvent(event: NostrEvent): boolean {
  try {
    if (eventIdFor(event) !== event.id) return false;
    return verifyEvent(event);
  } catch {
    return false;
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export class CrewRelay {
  private relay: Awaited<ReturnType<typeof Relay.connect>> | null = null;
  private backoffMs = 1000;
  private closed = false;

  constructor(
    private readonly relayUrl: string,
    private readonly privateKey: string,
  ) {}

  async subscribe(
    filter: { kinds: number[]; "#p": string[] },
    onEvent: (event: NostrEvent) => void,
  ): Promise<void> {
    const connect = async (): Promise<void> => {
      if (this.closed) return;
      try {
        this.relay = await Relay.connect(this.relayUrl);
        this.backoffMs = 1000;
        // NIP-42: nostr-tools ≥2.2 hands us the pre-built auth event template
        // (kind 22242 with challenge+relay tags) — we only sign it.
        this.relay.onauth = (authEvent) =>
          Promise.resolve(finalizeEvent(authEvent, hexToBytes(this.privateKey)));
        this.relay.subscribe([{ ...filter, since: Math.floor(Date.now() / 1000) }], {
          onevent: (event: NostrEvent) => {
            if (verifyCrewEvent(event)) onEvent(event);
          },
          onclose: () => {
            if (this.closed) return;
            const delay = this.backoffMs;
            this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
            setTimeout(() => void connect(), delay);
          },
        });
      } catch {
        if (this.closed) return;
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
        setTimeout(() => void connect(), delay);
      }
    };
    await connect();
  }

  async publish(event: NostrEvent): Promise<void> {
    if (!this.relay) throw new Error("relay not connected");
    await this.relay.publish(event);
  }

  close(): void {
    this.closed = true;
    this.relay?.close();
  }
}
