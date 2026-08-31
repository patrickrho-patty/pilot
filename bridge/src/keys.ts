import { generateSecretKey, getPublicKey } from "nostr-tools";

export type MintedKey = {
  pubkey: string;
  privateKeyHex: string;
};

/** Mint a fresh NIP-01 keypair for a new employee identity. */
export function mintKey(): MintedKey {
  const sk = generateSecretKey();
  return {
    pubkey: getPublicKey(sk),
    privateKeyHex: Buffer.from(sk).toString("hex"),
  };
}
