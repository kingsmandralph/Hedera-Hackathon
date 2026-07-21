# settle402

**Pay-to-read data marketplace on Hedera via the [x402](https://x402.org) payment standard — where no file is delivered before the payment is independently confirmed on-chain.**

Built for the [Hedera x402 bounty](https://hedera.com/x402-bounty/). Buyers pay native **HBAR** on Hedera testnet using the x402 `exact` scheme; the resource server releases an encrypted file **only after** it re-reads settlement from the **Hedera Mirror Node**. The two reference implementations deliver on payment *verification* and settle *afterward* (a documented deliver-before-settle race) — settle402 treats payment as a security boundary and ships attack/defend tests (T1–T4) proving the naive path leaks while the hardened path blocks.

> Status: **P0 scaffold** (build in progress). Design spec: [`docs/superpowers/specs/2026-07-21-settle402-design.md`](docs/superpowers/specs/2026-07-21-settle402-design.md).

## Layout

```
packages/
  shared/        x402 challenge schema, AES-256-GCM crypto, mirror-node client, txId parser
  facilitator/   Hono fee-payer service: /supported /verify /settle (+ FAULTY_MODE)
  server/        Hono resource server: catalog + 402 + settle-before-deliver gate (+ NAIVE_MODE)
  agent/         CLI buyer + T1–T4 attack scripts
  web/           thin read-only catalog + settled-receipt log with HashScan links
```

## Quick start (once the buyer account is set)

```bash
cp .env.example .env      # fill in 3 funded ECDSA testnet accounts
npm install
npm run check:singleton   # must show exactly ONE @hiero-ledger/sdk
npm run build
# P1+: npm run facilitator | npm run server | npm run agent -- buy <fileId>
```

MIT.
