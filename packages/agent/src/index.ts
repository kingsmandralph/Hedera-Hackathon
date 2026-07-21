// settle402 agent — CLI buyer. `catalog` lists files; `buy <id>` runs the full x402 round-trip:
// GET -> 402 -> build+sign TransferTransaction -> pay (PAYMENT-SIGNATURE) -> read content + HashScan link.
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { PrivateKey, createClientHederaSigner } from "@x402/hedera";
import { loadRootEnv, requireEnv, optionalEnv, stripHexPrefix, hashscanTxUrl } from "@settle402/shared";

loadRootEnv();

const NETWORK = "hedera:testnet";
const SERVER_URL = optionalEnv("SERVER_URL", `http://localhost:${optionalEnv("SERVER_PORT", "4021")}`);
const BUYER_ID = requireEnv("BUYER_ACCOUNT_ID");
const buyerKey = PrivateKey.fromStringECDSA(stripHexPrefix(requireEnv("BUYER_PRIVATE_KEY")));

const signer = createClientHederaSigner(BUYER_ID, buyerKey, { network: NETWORK });
const client = new x402Client().register(NETWORK, new ExactHederaScheme(signer));
const http = new x402HTTPClient(client);

async function catalog(): Promise<void> {
  const res = await fetch(`${SERVER_URL}/catalog`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

async function buy(id: string): Promise<void> {
  const url = `${SERVER_URL}/files/${id}`;
  console.log(`[agent] GET ${url}`);
  const first = await fetch(url);
  if (first.status !== 402) {
    console.log(`[agent] expected 402, got ${first.status}: ${await first.text()}`);
    process.exitCode = 1;
    return;
  }

  const required = http.getPaymentRequiredResponse(
    (name: string) => first.headers.get(name),
    await first.clone().json().catch(() => undefined),
  );
  const acc = required.accepts[0];
  if (!acc) throw new Error("402 challenge had no accepts[]");
  const feePayer = (acc.extra as Record<string, unknown> | null | undefined)?.feePayer;
  console.log(`[agent] 402: pay ${acc.amount} tinybars of ${acc.asset} -> ${acc.payTo} (feePayer=${feePayer})`);

  const payload = await http.createPaymentPayload(required);
  const headers = http.encodePaymentSignatureHeader(payload);
  console.log(`[agent] signed; retrying with header ${Object.keys(headers)[0]}`);

  const paid = await fetch(url, { headers });
  const result = await http.processResponse(paid);
  console.log(`[agent] paymentStatus=${result.paymentStatus}`);

  if (result.paymentStatus === "settled") {
    const settle = result.header as { transaction?: string } | undefined;
    const txId = settle?.transaction ?? "(none)";
    console.log(`[agent] SETTLED  tx=${txId}`);
    console.log(`[agent] HashScan ${hashscanTxUrl(txId, NETWORK)}`);
    console.log(`[agent] content  ${JSON.stringify(result.body)}`);
  } else {
    console.log(`[agent] NOT settled body=${JSON.stringify(result.body)} header=${JSON.stringify(result.header)}`);
    process.exitCode = 1;
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "catalog") await catalog();
else if (cmd === "buy" && arg) await buy(arg);
else {
  console.log("usage: agent catalog | agent buy <fileId>");
  process.exitCode = 1;
}
