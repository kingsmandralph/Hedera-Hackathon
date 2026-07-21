import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

let loaded = false;

/** Walk up from cwd to find the repo-root .env and load it into process.env (once). */
export function loadRootEnv(): void {
  if (loaded) return;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(candidate);
      loaded = true;
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

export function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** Hedera SDK PrivateKey.fromStringECDSA does not want a 0x prefix. */
export function stripHexPrefix(key: string): string {
  return key.startsWith("0x") ? key.slice(2) : key;
}
