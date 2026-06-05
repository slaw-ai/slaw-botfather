import crypto from "node:crypto";
import argon2 from "argon2";

const KEY_PREFIX = "bfk_";

/** Generate a per-instance API key. Returned once, stored only as a hash. */
export function generateApiKey(): string {
  return KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
}

export async function hashApiKey(key: string): Promise<string> {
  return argon2.hash(key, { type: argon2.argon2id });
}

export async function verifyApiKey(hash: string, key: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, key);
  } catch {
    return false;
  }
}

/**
 * Fast non-secret fingerprint of a key, stored alongside the argon2 hash so
 * auth doesn't have to argon2-verify against every instance row. SHA-256 of
 * the key is fine here: the key has 256 bits of entropy, the fingerprint only
 * narrows the candidate row; argon2 verification still gates acceptance.
 */
export function fingerprintApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}
