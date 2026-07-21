# settle402 — Design Spec

> Pay-to-read data marketplace on Hedera using the x402 payment standard, where **no file is delivered before the payment is independently confirmed on-chain.** Built for the Hedera x402 bounty (5 × $1,000, deadline **2026-07-31 11:59 PM ET**).

**Status:** ✅ BUILT (2026-07-21). P0–P4 complete and pushed; the hardened flow, T1–T4 attack suite, and UI all run on live Hedera testnet. A post-build adversarial review (SHIP-WITH-FIXES) was applied: pending-redeem path (no lost HBAR on mirror lag), payer derived from signed bytes, malformed-header guard, `is_approval` filter, `VAULT_SECRET`. See `docs/p1-proof.md`, `docs/p3-foolproof.md`, and the README. This spec is the original design record; where it and the code differ, the code (and README residual-risks) win.

---

## 1. What it is

`settle402` is an x402-gated pay-to-read marketplace. A buyer agent requests a file, receives an HTTP `402 Payment Required` challenge, pays with native **HBAR** on Hedera testnet via the x402 **"exact"** scheme, and receives the file **only after** the resource server *independently* confirms settlement on the **Hedera Mirror Node**.

The differentiator: the two reference implementations deliver content on payment *verification* and settle *afterward* (the Arch 1 reference documents this in its README: *"settle runs after the handler returns 200 — a verify-pass/settle-fail means data was delivered without payment landing"*). `settle402` treats payment as a **security boundary**: it gates delivery on observed on-chain consensus, and ships four attack/defend demos (T1–T4) proving the naive path leaks while the hardened path blocks — each with distinct on-chain artifacts and HashScan links.

## 2. Bounty requirements → how we meet them

| Requirement | Plan |
|---|---|
| Public open-source GitHub repo | `settle402`, MIT, created day 1 |
| Demo video < 5 min (end-to-end + on-chain txs) | Scripted, ~225s of 300s budget; mirror-wait segments sped up in post |
| HashScan links to testnet txs | Emitted by every purchase + attack script; `https://hashscan.io/testnet/transaction/{seconds}-{nanoseconds}` |
| Completed Google form | Filled at submission (fields catalogued in §11) |
| **Judging: working end-to-end flow** | P1 happy-path proof-of-life on live testnet |
| **Judging: genuine on-chain x402 payments** | Native `TransferTransaction`, exact scheme, mirror-node-verified |
| **Judging: effective use of Hedera infra** | TransferTransaction + Mirror Node gate (+ optional HCS receipts, USDC/HTS) |

## 3. Architecture

npm-workspaces monorepo, TypeScript, Node 20.

```
settle402/
  package.json            # workspaces + npm "overrides" SDK singleton lock (see §5)
  .env / .env.example     # gitignored real / committed template
  packages/
    shared/               # x402 challenge schema, AES-256-GCM crypto, mirror-node client, txId parser, types
    facilitator/          # Hono svc, ECDSA fee-payer. GET /supported, POST /verify, POST /settle. FAULTY_MODE flag
    server/               # Hono resource server. Catalog + GET /files/:id -> 402 -> gate -> key release. NAIVE_MODE flag
    agent/                # CLI buyer + attack scripts (T1-T4)
    web/                  # thin read-only catalog + settled-receipt log w/ HashScan links
```

**Three funded ECDSA testnet accounts:** facilitator (fee-payer, ≥50 HBAR), server (payTo, ≥10 HBAR), buyer (≥10 HBAR).

## 4. Corrected x402 protocol details (post-review — these are the load-bearing fixes)

- **Packages:** `@x402/hedera` (scheme, SDK re-exports), `@x402/core` (schemas/types), **`@x402/hono`** (server middleware — *not* `@x402/core` for the HTTP layer). SDK dependency is `@hiero-ledger/sdk` (pulled transitively; never a direct dep — see §5).
- **402 response header:** `PAYMENT-REQUIRED` (base64 `PaymentRequirements`).
- **Inbound payment header:** **`PAYMENT-SIGNATURE`** (case-insensitive). *(Not `PAYMENT-PAYLOAD` — that name does not exist in x402.)*
- **`PaymentRequirements` V2 schema (exact fields):** `{ scheme:"exact", network:"hedera:testnet", amount, asset, payTo, maxTimeoutSeconds, extra }`. There is **no** top-level `nonce`, `memo`, `fileId`, or `expiry`. Our per-purchase data (`fileId`, server `nonce`) lives in **`extra`**. Timeout is `maxTimeoutSeconds` (integer seconds), not a timestamp.
- **`extra.feePayer` is REQUIRED** and must equal the facilitator's account ID. Populate it at server startup from the facilitator's `GET /supported`; fail fast if missing/unreachable. Both the client signer and facilitator verifier throw `feePayer is required` without it.
- **Asset IDs:** HBAR = `0.0.0`; USDC testnet = `0.0.429274` (stretch; requires `TokenAssociateTransaction` on payTo + buyer first).
- **No transaction memo** is set by `@x402/hedera`. The **idempotency key is the Hedera `TransactionId`** (format `0.0.{acct}@{sec}.{nanos}`), generated from the *feePayer* account. Binding to a specific file is done via the x402 `resource` URL + `extra.fileId`, verified server-side — **not** via a tx memo.
- **Facilitator already blocks on `getReceipt()`** before returning from `/settle`, so its response implies consensus. Our mirror-node re-read is *independent verification* (amount/asset/payer), layered on top — and it must poll (5–10s propagation lag).

## 5. Pre-build hard prerequisites (P0 — before any code)

1. **Three funded ECDSA testnet accounts** (portal.hedera.com). Blocks everything.
2. **SDK singleton lock:** root `package.json` `"overrides"` pinning `@hiero-ledger/sdk` + `@hiero-ledger/proto` to the single version `@x402/hedera` uses. Import SDK types **only** via `@x402/hedera` re-exports in every workspace. Verify `npm ls @hiero-ledger/sdk` shows exactly one instance. *(Duplicate instances → runtime `t.startsWith is not a function` crash — documented in the `@x402/hedera` README.)*
3. **Facilitator account ID known** before writing `shared/` challenge types (needed for `extra.feePayer`).
4. **Pin exact package versions** (no `^`/`~`): `@x402/hedera` and `@x402/core` at the versions the `scaffold-hbar` reference uses; no `npm update` during the build window.

## 6. The settle-before-deliver gate (the core, corrected)

Hardened `GET /files/:id` flow:
1. Server issues `402` + `PaymentRequirements` (exact schema, `extra.feePayer`, `extra.fileId`, server-issued cryptographically-random `extra.nonce` ≥128-bit, `maxTimeoutSeconds`). Nonce recorded in the durable store keyed to `(resource, nonce, expiry)`.
2. Buyer builds native `TransferTransaction` (payTo, amount), partially signs with buyer ECDSA key, sends `PAYMENT-SIGNATURE`.
3. **Server extracts the expected `TransactionId` from the buyer's signed transaction bytes** and stores it. *(Do not trust the facilitator's returned txId — critical fix.)*
4. Server → facilitator `/verify` → `/settle` (facilitator co-signs as fee-payer, submits, blocks on receipt).
5. **Gate:** server polls Mirror Node `GET /api/v1/transactions/{expected_txId}` (exponential backoff 0.5→8s, **30s hard cap**) until `result == SUCCESS`, then verifies:
   - **net** balance change to `payTo` (sum of *all* transfer legs where `account == payTo`, incl. negatives) `>= amount` — never "an entry exists";
   - correct asset list (`hbar_transfers` for HBAR vs `token_transfers` for HTS);
   - `txId` not already consumed — enforced by `INSERT` against a `UNIQUE(txId)` constraint (atomic; no SELECT-then-INSERT).
6. On success: release a **single-use** AES-256-GCM content-key token, server-side TTL checked at redemption, `txId` marked consumed durably.
7. On 30s timeout: return `402` + `Retry-After` + a `/receipts/:receiptId` polling endpoint; never hold the connection; cap concurrent pending settlements. Emit public receipt `{fileId, buyerAccount, txId, hashscanUrl, settledAt}` → web UI.

## 7. Threat model (each = a test + on-chain artifact)

| ID | Attack | Naive path | Hardened control |
|----|--------|-----------|------------------|
| **T1** | Deliver-before-settle race | releases file after `/verify`, settles async; `FAULTY_MODE` facilitator drops settle → file leaked, chain shows no payment | poll Mirror Node for SUCCESS before any release |
| **T2** | Replay (reuse settled tx/nonce for a 2nd file, incl. after restart, incl. concurrent) | issues 2nd key | durable SQLite `UNIQUE(txId)`; nonce bound to resource |
| **T3** | Amount/asset tamper (underpay, wrong token, circular multi-leg) | accepts | net-balance check + asset-list routing |
| **T4** | Delivery-token reuse | reusable | single-use key, server-side TTL, `txId`-encoded token verified vs durable store |

`FAULTY_MODE` simulates the **application-layer** race (verify passes, `/settle` returns `{success:false, error:"faulty_mode_settle_dropped"}` without touching Hedera) — proving the bug is app-layer, not network.

## 8. Data & storage

- Files **AES-256-GCM encrypted at rest** in `server/vault/`; per-file content key released as a single-use token post-settlement (**not** presigned S3 URLs — a presigned URL is a bearer token).
- **Durable SQLite (WAL)** for: catalog (fileId → price → payTo), issued nonces, `consumed_payments(txId UNIQUE)`. Survives restart.
- No MinIO/Docker/Solidity.

## 9. Documented residual risks (honest README trade-offs, not hidden)

- **Content-key leakability (pay-once, distribute-many):** inherent to symmetric-key release. Documented; production fix = server-side streaming decryption. *(Medium.)*
- **Mirror-node TLS/DNS spoofing:** gate trusts the mirror HTTPS response. Production fix = cert pinning or Hedera state proofs.
- **Catalog price/payTo has no on-chain anchor:** production fix = HCS-published catalog buyers verify pre-sign.
- **Buyer-account binding is metadata-only** unless a redemption-time ECDSA challenge-response is added (noted as production hardening).
- **Testnet reset risk** before 07-31: check schedule; store mirror-node JSON receipts in-repo as evidence fallback.

## 10. Phase plan (~25h work / 36–48h available; deadline not at risk)

- **P0** — accounts + SDK singleton lock + scaffold workspaces + wire `.env` + apply all §4 corrections to `shared/`. Scaffold `NAIVE_MODE`/`FAULTY_MODE` flags from day 1.
- **P1 (proof-of-life gate)** — facilitator `/supported`+`/verify`+`/settle` w/ real ECDSA co-sign; server 402 (naive gate); agent build+pay+decrypt; **one full round-trip on testnet + HashScan link verified in a browser**; capture txId as P2 test fixture.
- **P2** — `shared/mirrorNode.ts` (tested vs P1 txId) → hardened gate (independent txId, net-balance, asset routing, poll+timeout); durable replay store; single-use key.
- **P3** — attack scripts T1–T4; confirm naive fails / hardened blocks for all four.
- **P4** — thin web UI (catalog + receipts + HashScan); README (architecture, mirror-gate diagram, T1–T4 table, residual-risk notes); record + upload demo.
- **Stretch (only if P0–P4 solid):** HCS receipt topic; USDC/HTS (+ association setup script).

## 11. Blocking user inputs

1. **3 funded ECDSA testnet accounts** — (AccountId, 0x-hex private key) × facilitator/server/buyer → `.env` (gitignored). **P0 hard gate.**
2. **GitHub repo** — name + public confirmation (token already provided; repo to be created).
3. **Submission form data (later):** team name(s)+email(s), nominated payee + prize method (HBAR mainnet acct vs fiat), 3-sentence description (draft in §1), video URL/host, five 1–10 DX ratings (post-build).

## 12. Submission checklist (definition of done)

- [ ] Public repo, MIT, README complete
- [ ] P1 happy-path works on live testnet, HashScan link verified in browser
- [ ] T1–T4 attack/defend all demonstrated with on-chain artifacts
- [ ] Demo video < 5 min uploaded, URL stable
- [ ] HashScan links collected + mirror-node JSON receipts stored in-repo
- [ ] Google form submitted before 2026-07-31 11:59 PM ET
