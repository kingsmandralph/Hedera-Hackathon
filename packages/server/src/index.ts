// settle402 resource server — pay-to-read data marketplace on Hedera via x402.
//
// HARDENED (default): a file is released ONLY after the server independently confirms settlement on
// the Hedera Mirror Node — using the TransactionId it extracts from the buyer's OWN signed payload
// (never trusting the facilitator's returned id), checking net balance credited to payTo, and
// atomically claiming the txId single-use. NAIVE_MODE reproduces the reference's deliver-before-settle
// race for the T1 attack demo.
import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { extractTransactionFromPayload, inspectHederaTransaction } from "@x402/hedera";
import { join } from "node:path";
import {
  loadRootEnv, requireEnv, optionalEnv, tinybarsToHbar, hashscanTxUrl,
  getMirrorTransaction, netHbarTo, deriveKey, seal, unseal, b64encode, b64decode, ConsumedStore,
  type Sealed,
} from "@settle402/shared";

loadRootEnv();

const NETWORK = "hedera:testnet";
const PAY_TO = requireEnv("SERVER_ACCOUNT_ID");
const FACILITATOR_URL = optionalEnv("FACILITATOR_URL", "http://localhost:4020");
const PORT = Number(optionalEnv("SERVER_PORT", "4021"));
const NAIVE = optionalEnv("NAIVE_MODE", "false") === "true";
const PRICE_TINYBARS = optionalEnv("FILE_PRICE_TINYBARS", "10000000"); // 0.1 HBAR
const DATA_DIR = optionalEnv("DATA_DIR", join(process.cwd(), ".data", "server"));

interface CatalogItem { id: string; name: string; description: string; content: unknown; }
const CATALOG: CatalogItem[] = [
  { id: "btc-ohlc-1h", name: "BTC/USD 1h OHLC", description: "Latest hourly candle snapshot", content: { symbol: "BTC/USD", interval: "1h", o: 61250.4, h: 61480.0, l: 61010.2, c: 61390.7, v: 1843.2, ts: "2026-07-21T12:00:00Z" } },
  { id: "eth-orderbook", name: "ETH/USD order book (top 5)", description: "Level-2 depth snapshot", content: { symbol: "ETH/USD", bids: [[3390.1, 12.4], [3389.8, 30.0]], asks: [[3390.6, 9.1], [3391.0, 22.7]], ts: "2026-07-21T12:00:05Z" } },
  { id: "hbar-metrics", name: "HBAR network metrics", description: "Throughput + fee snapshot", content: { network: "hedera:mainnet", tps: 173.4, avgFeeUsd: 0.00007, ts: "2026-07-21T12:00:10Z" } },
];

// Encryption at rest: each file is sealed under the server master key and only unsealed after payment.
const MASTER_KEY = deriveKey(optionalEnv("VAULT_SECRET", "settle402-dev-vault-secret"));
const VAULT = new Map<string, Sealed>();
for (const item of CATALOG) VAULT.set(item.id, seal(JSON.stringify(item.content), MASTER_KEY));

const consumed = new ConsumedStore(join(DATA_DIR, "consumed"));
const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

interface Receipt { fileId: string; buyer: string; txId: string; hashscan: string; settledAt: string; }
const receipts: Receipt[] = [];

let FEE_PAYER = "";
async function loadFeePayer(): Promise<void> {
  const res = await fetch(`${FACILITATOR_URL}/supported`);
  const j = (await res.json()) as { kinds?: Array<{ scheme: string; network: string; extra?: { feePayer?: string } }> };
  const kind = j.kinds?.find((k) => k.network === NETWORK && k.scheme === "exact");
  if (!kind?.extra?.feePayer) throw new Error("facilitator /supported did not advertise feePayer — is it running?");
  FEE_PAYER = kind.extra.feePayer;
}
await loadFeePayer();

function requirementsFor(fileId: string): PaymentRequirements {
  return { scheme: "exact", network: NETWORK, amount: PRICE_TINYBARS, asset: "0.0.0", payTo: PAY_TO, maxTimeoutSeconds: 180, extra: { feePayer: FEE_PAYER, fileId } } as PaymentRequirements;
}

function deliver(c: Context, item: CatalogItem, note?: string) {
  const plaintext = unseal(VAULT.get(item.id)!, MASTER_KEY).toString("utf8");
  return c.json({ id: item.id, name: item.name, content: JSON.parse(plaintext), ...(note ? { note } : {}) });
}

const UI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>settle402 — pay-to-read on Hedera (x402)</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0b0e14;color:#c9d1d9;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:900px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#8b949e;margin:0 0 6px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:700;font-size:12px}
.hardened{background:#0f3d2e;color:#3fb950;border:1px solid #238636}
.naive{background:#3d1f1f;color:#f85149;border:1px solid #da3633}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin:28px 0 10px;border-bottom:1px solid #21262d;padding-bottom:6px}
table{width:100%;border-collapse:collapse}
td,th{text-align:left;padding:8px 10px;border-bottom:1px solid #161b22;vertical-align:top}
th{color:#8b949e;font-weight:600;font-size:12px}
a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}
.price{color:#3fb950}.muted{color:#6e7681}.empty{color:#6e7681;padding:12px 10px}
code{background:#161b22;padding:1px 5px;border-radius:4px}
</style></head><body><div class="wrap">
<h1>settle402 <span id="mode" class="badge">…</span></h1>
<p class="sub">Pay-to-read data marketplace on Hedera testnet via the x402 <code>exact</code> scheme.</p>
<p class="sub muted">No file is released until settlement is <b>independently confirmed on the Hedera Mirror Node</b>. Buyers pay with the CLI agent; this page is read-only.</p>
<h2>Catalog</h2>
<table><thead><tr><th>File</th><th>Description</th><th>Price</th></tr></thead><tbody id="catalog"></tbody></table>
<h2>Settled receipts (live)</h2>
<table><thead><tr><th>File</th><th>Buyer</th><th>Transaction</th></tr></thead><tbody id="receipts"><tr><td class="empty" colspan="3">No purchases yet — run <code>npm run agent -- buy &lt;id&gt;</code></td></tr></tbody></table>
</div>
<script>
async function load(){
  try{
    const cat=await (await fetch('/catalog')).json();
    document.getElementById('mode').textContent=cat.mode;
    document.getElementById('mode').className='badge '+(cat.mode==='hardened'?'hardened':'naive');
    document.getElementById('catalog').innerHTML=cat.files.map(f=>
      '<tr><td><b>'+f.id+'</b><br><span class="muted">'+f.name+'</span></td><td>'+f.description+'</td><td class="price">'+cat.price.human+'</td></tr>').join('');
    const rec=(await (await fetch('/receipts')).json()).receipts;
    if(rec.length) document.getElementById('receipts').innerHTML=rec.slice().reverse().map(r=>
      '<tr><td><b>'+r.fileId+'</b></td><td class="muted">'+r.buyer+'</td><td><a href="'+r.hashscan+'" target="_blank">'+r.txId+'</a></td></tr>').join('');
  }catch(e){}
}
load();setInterval(load,3000);
</script></body></html>`;

const app = new Hono();

app.get("/", (c) => c.html(UI_HTML));

app.get("/catalog", (c) =>
  c.json({
    mode: NAIVE ? "naive" : "hardened",
    price: { asset: "HBAR", amountTinybars: PRICE_TINYBARS, human: tinybarsToHbar(PRICE_TINYBARS) },
    payTo: PAY_TO,
    files: CATALOG.map(({ content: _content, ...meta }) => meta),
  }),
);

app.get("/receipts", (c) => c.json({ receipts }));

app.get("/files/:id", async (c) => {
  const id = c.req.param("id");
  const item = CATALOG.find((f) => f.id === id);
  if (!item) return c.json({ error: "not_found" }, 404);

  const sig = c.req.header("PAYMENT-SIGNATURE") ?? c.req.header("payment-signature");
  if (!sig) {
    const reqs = requirementsFor(id);
    const paymentRequired = { x402Version: 2, resource: { url: c.req.url, description: `settle402 ${id}`, mimeType: "application/json" }, accepts: [reqs] };
    c.header("PAYMENT-REQUIRED", b64encode(paymentRequired));
    return c.json(paymentRequired, 402);
  }

  const payload = b64decode<PaymentPayload>(sig);
  const reqs = requirementsFor(id);

  // Independent inspection: extract OUR txId and validate transfers straight from the signed tx bytes.
  // This is the fix for the critical facilitator-trust hole — we never use the facilitator's returned id.
  let expectedTxId: string;
  let localNet = 0n;
  try {
    const txB64 = extractTransactionFromPayload(payload.payload as { transaction: string });
    const inspected = inspectHederaTransaction(txB64);
    expectedTxId = inspected.transactionId;
    localNet = inspected.hbarTransfers.filter((l) => l.accountId === PAY_TO).reduce((s, l) => s + BigInt(l.amount), 0n);
  } catch {
    return c.json({ error: "bad_payload_transaction" }, 400);
  }
  if (localNet < BigInt(PRICE_TINYBARS)) return c.json({ error: "amount_too_low" }, 402);

  if (consumed.has(expectedTxId)) return c.json({ error: "replay_already_consumed" }, 409);

  const v = await facilitator.verify(payload, reqs);
  if (!v.isValid) return c.json({ error: `verify:${v.invalidReason}` }, 402);

  if (NAIVE) {
    // Reference-style race: hand over the file NOW; settle fire-and-forget (may never land).
    void facilitator.settle(payload, reqs).catch(() => {});
    return deliver(c, item, "naive-mode: delivered before on-chain settlement confirmed");
  }

  // HARDENED — settle, then INDEPENDENTLY confirm on the mirror node using OUR txId.
  const s = await facilitator.settle(payload, reqs);
  if (!s.success) return c.json({ error: `settle:${s.errorReason}` }, 402);

  const tx = await getMirrorTransaction(expectedTxId, NETWORK, { timeoutMs: 30_000 });
  if (!tx) return c.json({ error: "mirror_confirm_timeout" }, 402);
  if (tx.result !== "SUCCESS") return c.json({ error: `onchain_${tx.result}` }, 402);
  if (netHbarTo(tx, PAY_TO) < BigInt(PRICE_TINYBARS)) return c.json({ error: "onchain_amount_short" }, 402);
  if (tx.token_transfers && tx.token_transfers.length > 0) return c.json({ error: "unexpected_token_transfer" }, 402);

  // Atomic single-use claim — replay + concurrent double-spend + restart-safe (T2/T4).
  if (!consumed.claim(expectedTxId, JSON.stringify({ fileId: id, payer: v.payer, at: tx.consensus_timestamp }))) {
    return c.json({ error: "replay_already_consumed" }, 409);
  }

  const settleResp = { success: true, network: NETWORK, payer: v.payer ?? "", transaction: expectedTxId, amount: PRICE_TINYBARS };
  c.header("PAYMENT-RESPONSE", b64encode(settleResp));
  receipts.push({ fileId: id, buyer: v.payer ?? "", txId: expectedTxId, hashscan: hashscanTxUrl(expectedTxId, NETWORK), settledAt: tx.consensus_timestamp });
  return deliver(c, item);
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[server] :${PORT} payTo=${PAY_TO} feePayer=${FEE_PAYER} mode=${NAIVE ? "NAIVE" : "HARDENED"}`);
