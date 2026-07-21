// settle402 attack/defend suite (the "foolproof" tests).
// Each attack runs against the current server and prints PASS/FAIL vs an expected outcome.
//   T1 race     — deliver-before-settle: naive LEAKS (file out, no on-chain payment); hardened BLOCKS.
//   T2 replay   — re-present the same settled payload: naive LEAKS; hardened 409.
//   T3 underpay — sign a transfer below the price: BLOCKED (net-balance check).
//   T4 crossfile— pay for file A, reuse the same payment for file B: naive LEAKS; hardened 409.
//
// Usage: node dist/attacks.js <race|replay|underpay|crossfile> <block|leak> [args...]
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import {
  ExactHederaScheme,
  PrivateKey,
  createClientHederaSigner,
  TransferTransaction,
  TransactionId,
  AccountId,
  Hbar,
  createHederaClient,
  inspectHederaTransaction,
} from "@x402/hedera";
import { loadRootEnv, requireEnv, optionalEnv, stripHexPrefix, b64encode, hashscanTxUrl, getMirrorTransaction } from "@settle402/shared";

loadRootEnv();
const NETWORK = "hedera:testnet";
const SERVER = optionalEnv("SERVER_URL", `http://localhost:${optionalEnv("SERVER_PORT", "4021")}`);
const BUYER_ID = requireEnv("BUYER_ACCOUNT_ID");
const buyerKey = PrivateKey.fromStringECDSA(stripHexPrefix(requireEnv("BUYER_PRIVATE_KEY")));

const signer = createClientHederaSigner(BUYER_ID, buyerKey, { network: NETWORK });
const client = new x402Client().register(NETWORK, new ExactHederaScheme(signer));
const http = new x402HTTPClient(client);

type Headers = Record<string, string>;

async function honestPayload(fileId: string): Promise<{ headers: Headers; txId: string }> {
  const first = await fetch(`${SERVER}/files/${fileId}`);
  const required = http.getPaymentRequiredResponse((n: string) => first.headers.get(n), await first.clone().json().catch(() => undefined));
  const payload = await http.createPaymentPayload(required);
  const headers = http.encodePaymentSignatureHeader(payload) as Headers;
  const txB64 = (payload.payload as unknown as { transaction: string }).transaction;
  return { headers, txId: inspectHederaTransaction(txB64).transactionId };
}

async function craftUnderpay(fileId: string, amountTinybars: string): Promise<Headers> {
  const first = await fetch(`${SERVER}/files/${fileId}`);
  const body = (await first.json()) as { accepts: Array<{ payTo: string; extra: { feePayer: string } }> };
  const acc = body.accepts[0]!;
  const amount = BigInt(amountTinybars);
  const tx = new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(BUYER_ID), Hbar.fromTinybars((-amount).toString()))
    .addHbarTransfer(AccountId.fromString(acc.payTo), Hbar.fromTinybars(amount.toString()))
    .setTransactionId(TransactionId.generate(AccountId.fromString(acc.extra.feePayer)));
  const c = createHederaClient(NETWORK);
  tx.freezeWith(c);
  const signed = await tx.sign(buyerKey);
  c.close();
  const payload = { x402Version: 2, accepted: acc, payload: { transaction: Buffer.from(signed.toBytes()).toString("base64") } };
  return { "PAYMENT-SIGNATURE": b64encode(payload) };
}

const send = (fileId: string, headers: Headers) => fetch(`${SERVER}/files/${fileId}`, { headers });
async function delivered(res: Response): Promise<boolean> {
  if (res.status !== 200) return false;
  const b = (await res.json().catch(() => ({}))) as { content?: unknown };
  return b.content !== undefined;
}

function verdict(name: string, leaked: boolean, expect: "block" | "leak", detail: string): void {
  const ok = expect === "leak" ? leaked : !leaked;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  [expected ${expect}, ${leaked ? "LEAKED" : "blocked"}]  ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [attack, expect, a, b] = process.argv.slice(2) as [string, "block" | "leak", string?, string?];

  if (attack === "race") {
    const { headers, txId } = await honestPayload(a!);
    const res = await send(a!, headers);
    const leaked = await delivered(res);
    const onchain = await getMirrorTransaction(txId, NETWORK, { timeoutMs: 9_000 });
    const settled = !!onchain && onchain.result === "SUCCESS";
    verdict("T1-race", leaked, expect, `status=${res.status} onchainSettled=${settled} tx=${settled ? hashscanTxUrl(txId) : "(never landed)"}`);
    return;
  }
  if (attack === "replay") {
    const { headers } = await honestPayload(a!);
    const r1 = await send(a!, headers);
    const r2 = await send(a!, headers);
    verdict("T2-replay", await delivered(r2), expect, `first=${r1.status} replay=${r2.status}`);
    return;
  }
  if (attack === "underpay") {
    const headers = await craftUnderpay(a!, b ?? "1");
    const res = await send(a!, headers);
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    verdict("T3-underpay", await delivered(res), expect, `paid=${b ?? "1"}tinybars status=${res.status} ${body.error ?? ""}`);
    return;
  }
  if (attack === "crossfile") {
    const { headers } = await honestPayload(a!);
    const r1 = await send(a!, headers);
    const r2 = await send(b!, headers);
    verdict("T4-crossfile", await delivered(r2), expect, `paidFor=${a}(${r1.status}) reuseOn=${b}(${r2.status})`);
    return;
  }
  console.log("usage: attacks <race|replay|underpay|crossfile> <block|leak> [args...]");
  process.exitCode = 1;
}

await main();
