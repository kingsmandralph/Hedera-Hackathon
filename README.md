# settle402

**A pay-to-read data marketplace on Hedera, built on the [x402](https://x402.org) payment standard — where no file is delivered until the payment is *independently confirmed on-chain*.**

Built for the [Hedera x402 bounty](https://hedera.com/x402-bounty/). An AI buyer agent requests a data file, receives an HTTP `402 Payment Required`, pays with native **HBAR** on Hedera testnet using the x402 `exact` scheme, and receives the (encrypted-at-rest) file **only after** the resource server re-reads settlement from the **Hedera Mirror Node**.

### Why this one is different

The two reference implementations deliver content on payment *verification* and settle *afterward* — the market-data reference documents the flaw in its own README:

> *“settle runs after the handler returns 200 — a verify-pass / settle-fail means data was delivered without payment landing.”*

**settle402 treats payment as a security boundary.** It gates every file release on an independent Mirror-Node confirmation and ships an automated attack/defend suite (T1–T4) proving the naive path leaks while the hardened path blocks — every assertion checked against live testnet. See [`docs/p3-foolproof.md`](docs/p3-foolproof.md).

---

## Architecture

```
                 ┌────────────┐   402 + PaymentRequirements    ┌──────────────┐
                 │  agent     │ ─────────────────────────────▶ │   server     │
                 │  (buyer,   │                                │  (resource,  │
                 │   ECDSA)   │ ◀───────────────────────────── │   payTo)     │
                 └────┬───────┘   PAYMENT-SIGNATURE (signed tx) └──────┬───────┘
                      │ signs TransferTransaction                      │ verify + settle
                      │                                                ▼
                      │                                        ┌──────────────┐
                      │                                        │ facilitator  │  co-signs as
                      │                                        │ (fee-payer,  │  fee-payer,
                      │                                        │   ECDSA)     │  submits tx
                      │                                        └──────┬───────┘
                      │                                               │ submit
                      ▼                                               ▼
              ┌───────────────────────  Hedera testnet  ───────────────────────┐
              │            TransferTransaction (buyer → payTo, fee-payer pays)  │
              └───────────────────────────────┬────────────────────────────────┘
                                               │ the server INDEPENDENTLY re-reads
                                               ▼
                                        ┌──────────────┐
                                        │ Mirror Node  │  SUCCESS? net ≥ price?
                                        │  REST API    │  asset ok? txId unused?
                                        └──────────────┘  → release the file
```

### The hardened gate (`server/src/index.ts`)

1. `GET /files/:id` with no payment → `402` + `PaymentRequirements` (`extra.feePayer` pulled from the facilitator's `/supported`).
2. Buyer builds a native Hedera `TransferTransaction` (buyer → payTo), partially signs, sends `PAYMENT-SIGNATURE`.
3. Server **extracts the expected `TransactionId` from the buyer's own signed bytes** — never trusting the facilitator's returned id (fixes the facilitator-trust hole).
4. Server → facilitator `/verify` → `/settle` (facilitator co-signs as fee-payer, submits, waits for consensus).
5. **Gate:** server polls the **Mirror Node** for *its* txId (backoff, 30 s cap) and requires `SUCCESS` + **net** HBAR credited to `payTo` ≥ price + correct asset + `txId` not already consumed (atomic, durable, single-use claim).
6. Only then is the AES-256-GCM file unsealed and returned, with a settlement receipt.

---

## Threat model — proven, not asserted (`bash scripts/foolproof.sh`)

| ID | Attack | Naive server (= reference) | settle402 hardened |
|----|--------|----------------------------|--------------------|
| **T1** | Deliver-before-settle race | 🩸 file leaked, no payment on-chain | 🛡️ `402` — mirror-confirm before release |
| **T2** | Replay a settled payload | 🩸 delivered again | 🛡️ `409` — durable single-use `txId` |
| **T3** | Underpayment | — | 🛡️ `402` — net-balance check on signed tx |
| **T4** | Cross-file reuse | 🩸 unlocks other file | 🛡️ `409` — `txId` consumed globally |

All 6 assertions pass on live testnet.

---

## Effective use of Hedera infrastructure

- **Native `TransferTransaction`** for payment (HBAR), with the facilitator as fee-payer so the buyer pays no gas.
- **Hedera Mirror Node REST API** as the independent settlement oracle — the core of the security gate; the pattern is impossible without it.
- x402 `exact` scheme via the official `@x402/hedera` + `@x402/core` + `@x402/hono` packages (pinned `2.19.0`), with the `@hiero-ledger/sdk` single-instance lock the README warns about, verified in CI-style at build.

---

## Quickstart

Requires **Node 20** and three funded **ECDSA** Hedera testnet accounts (free at [portal.hedera.com](https://portal.hedera.com)).

```bash
cp .env.example .env      # fill: FACILITATOR / SERVER(payTo) / BUYER account ids + 0x keys
npm install
npm run build
npm run check:singleton   # must show exactly ONE @hiero-ledger/sdk@2.85.0

# terminal 1 — fee-payer facilitator
node packages/facilitator/dist/index.js
# terminal 2 — marketplace + UI at http://localhost:4021
node packages/server/dist/index.js
# terminal 3 — the buyer agent
node packages/agent/dist/index.js catalog
node packages/agent/dist/index.js buy btc-ohlc-1h    # → prints a live HashScan link

# the whole foolproof suite (hardened blocks, naive leaks) on testnet:
bash scripts/foolproof.sh
```

The server serves a read-only web UI at **http://localhost:4021/** — catalog + a live settled-receipts feed with clickable HashScan links.

## Proof

- [`docs/p1-proof.md`](docs/p1-proof.md) — live testnet round-trips + HashScan links.
- [`docs/p3-foolproof.md`](docs/p3-foolproof.md) — the T1–T4 attack/defend results.

## Packages

| package | role |
|---|---|
| `packages/shared` | x402/Hedera helpers, Mirror-Node client, AES-256-GCM vault, durable replay store |
| `packages/facilitator` | fee-payer service: `/supported` `/verify` `/settle` (+ `FAULTY_MODE`, verify-retry) |
| `packages/server` | resource server: catalog, 402 challenge, hardened gate, UI (+ `NAIVE_MODE`) |
| `packages/agent` | CLI buyer + the T1–T4 attack suite |

## Residual risks (honest scope)

- **Content-key leakability** — a paying buyer can redistribute decrypted bytes; inherent to symmetric-key release. Production fix: server-side streaming decryption.
- **Mirror-node TLS/DNS trust** — the gate trusts the mirror HTTPS response; production fix: cert pinning or Hedera state proofs.
- **Catalog price/payTo have no on-chain anchor** — production fix: publish the catalog to an HCS topic.
- Full design + review in [`docs/superpowers/specs/2026-07-21-settle402-design.md`](docs/superpowers/specs/2026-07-21-settle402-design.md).

## License

MIT.
