import { openSync, writeSync, closeSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Durable, atomic, restart-safe replay guard.
 *
 * One file per consumed key. The claim is an exclusive-create (`wx`) open — the OS guarantees
 * exactly one caller wins even under concurrency, and the marker survives process restart. This
 * closes the T2 replay hole (incl. the restart-replay and concurrent-TOCTOU variants the review
 * flagged) without a native SQLite dependency — the filesystem provides the same atomicity + durability.
 */
export class ConsumedStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    return join(this.dir, encodeURIComponent(key));
  }

  /** Atomically claim `key`. Returns true if newly claimed, false if already consumed. */
  claim(key: string, meta = ""): boolean {
    let fd: number;
    try {
      fd = openSync(this.path(key), "wx"); // exclusive create — throws EEXIST if present
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
    try {
      if (meta) writeSync(fd, meta);
    } finally {
      closeSync(fd);
    }
    return true;
  }

  has(key: string): boolean {
    return existsSync(this.path(key));
  }
}

/**
 * Durable key→value store for settlements that settled on-chain but whose Mirror-Node confirmation
 * timed out. Lets the buyer redeem the file later instead of losing their HBAR (the review's HIGH bug).
 */
export class PendingStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.dir, encodeURIComponent(key));
  }
  set(key: string, value: string): void {
    writeFileSync(this.path(key), value);
  }
  get(key: string): string | null {
    try {
      return readFileSync(this.path(key), "utf8");
    } catch {
      return null;
    }
  }
  clear(key: string): void {
    try {
      rmSync(this.path(key));
    } catch {
      /* already gone */
    }
  }
}
