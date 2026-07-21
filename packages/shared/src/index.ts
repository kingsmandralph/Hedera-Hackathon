// settle402 shared — x402 challenge schema, AES-256-GCM crypto, mirror-node client, txId parser.
// P0 placeholder; real modules land in P1/P2. The @x402 SDK single-instance check is
// exercised at runtime via `npm run probe:exports` (avoids coupling tsc to SDK export names).

export const SETTLE402 = "settle402" as const;

export type Network = "hedera:testnet" | "hedera:mainnet";

/** Hedera TransactionId `0.0.acct@sec.nanos` -> HashScan testnet URL. */
export function hashscanUrl(txId: string, network: Network = "hedera:testnet"): string {
  const net = network === "hedera:mainnet" ? "mainnet" : "testnet";
  const at = txId.split("@")[1];
  if (!at) throw new Error(`unparseable TransactionId: ${txId}`);
  return `https://hashscan.io/${net}/transaction/${at.replace(".", "-")}`;
}
