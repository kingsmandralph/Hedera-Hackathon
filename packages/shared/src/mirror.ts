import type { Network } from "./hedera.js";
import { toMirrorTxId } from "./hedera.js";

const MIRROR: Record<Network, string> = {
  "hedera:testnet": "https://testnet.mirrornode.hedera.com",
  "hedera:mainnet": "https://mainnet-public.mirrornode.hedera.com",
};

export function mirrorBase(network: Network): string {
  return MIRROR[network];
}

export interface MirrorTransfer {
  account: string;
  amount: number; // tinybars, signed (credit positive / debit negative)
  is_approval?: boolean;
}

export interface MirrorTokenTransfer {
  token_id: string;
  account: string;
  amount: number;
}

export interface MirrorTransaction {
  transaction_id: string;
  result: string; // "SUCCESS" | ...
  consensus_timestamp: string;
  transfers: MirrorTransfer[];
  token_transfers?: MirrorTokenTransfer[];
  charged_tx_fee: number;
  name?: string;
}

/**
 * Independently re-read a settled transaction from the Hedera Mirror Node, polling with
 * exponential backoff until it appears or the timeout elapses. Returns null on timeout.
 * This is the basis of the settle-before-deliver gate (P2).
 */
export async function getMirrorTransaction(
  sdkTxId: string,
  network: Network = "hedera:testnet",
  opts: { timeoutMs?: number; startDelayMs?: number } = {},
): Promise<MirrorTransaction | null> {
  const id = toMirrorTxId(sdkTxId);
  const url = `${MIRROR[network]}/api/v1/transactions/${id}`;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let delay = opts.startDelayMs ?? 500;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { transactions?: MirrorTransaction[] };
        const tx = body.transactions?.[0];
        if (tx) return tx;
      }
    } catch {
      // network blip — keep polling
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 8_000);
  }
  return null;
}

/** Net tinybar change credited to `account` across all transfer legs (positive = received). */
export function netHbarTo(tx: MirrorTransaction, account: string): bigint {
  return tx.transfers
    .filter((t) => t.account === account)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
}
