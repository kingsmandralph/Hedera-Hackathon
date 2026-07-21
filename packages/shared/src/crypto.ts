import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/** AES-256-GCM sealed blob (encryption at rest for the file vault). */
export interface Sealed {
  iv: string;
  ct: string;
  tag: string;
}

export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

export function seal(plaintext: Buffer | string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const pt = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  return { iv: iv.toString("base64"), ct: ct.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function unseal(sealed: Sealed, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64")), decipher.final()]);
}

/** base64(JSON) — the x402 header encoding, done by hand so we never mis-encode a challenge. */
export function b64encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function b64decode<T = unknown>(b64: string): T {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as T;
}
