export type Network = "hedera:testnet" | "hedera:mainnet";

/** SDK TransactionId "0.0.x@sec.nanos" -> mirror/hashscan id "0.0.x-sec-nanos". */
export function toMirrorTxId(sdkTxId: string): string {
  return sdkTxId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
}

export function hashscanTxUrl(sdkTxId: string, network: Network = "hedera:testnet"): string {
  const net = network === "hedera:mainnet" ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/transaction/${toMirrorTxId(sdkTxId)}`;
}

export function hashscanAccountUrl(accountId: string, network: Network = "hedera:testnet"): string {
  const net = network === "hedera:mainnet" ? "mainnet" : "testnet";
  return `https://hashscan.io/${net}/account/${accountId}`;
}

/** tinybars (bigint/string) -> human HBAR string. 1 HBAR = 100,000,000 tinybars. */
export function tinybarsToHbar(tinybars: string | bigint): string {
  const t = typeof tinybars === "bigint" ? tinybars : BigInt(tinybars);
  const sign = t < 0n ? "-" : "";
  const abs = t < 0n ? -t : t;
  const whole = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? "." + frac : ""} ℏ`;
}
