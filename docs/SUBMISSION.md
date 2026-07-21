# Submission — Hedera x402 bounty

Form: https://forms.gle/oWbifBqkvbk2oANC7 · Deadline: **2026-07-31 11:59 PM ET**

## Ready-to-paste

**Project name:** settle402

**Repo (public):** https://github.com/kingsmandralph/Hedera-Hackathon

**Project description (3 sentences):**
> settle402 is a pay-to-read data marketplace where an AI buyer agent pays with native Hedera HBAR via the x402 “exact” payment scheme and receives an encrypted file only after settlement is independently confirmed on the Hedera Mirror Node. Unlike the reference x402-on-Hedera implementations — which deliver content before settlement confirms — settle402 gates every file release on a Mirror-Node consensus check (credited account, exact net amount, asset, single-use), closing the documented deliver-before-settle race. It uses a native Hedera TransferTransaction for payment with a facilitator fee-payer (so the buyer pays no gas) and the Mirror Node as an independent settlement oracle; a self-contained T1–T4 attack suite proves the naive path leaks while the hardened path blocks, all on live testnet.

**HashScan links (live testnet transactions):**
- https://hashscan.io/testnet/transaction/0.0.9674959-1784661723-935673110
- https://hashscan.io/testnet/transaction/0.0.9674959-1784661729-418068069
- https://hashscan.io/testnet/transaction/0.0.9674959-1784661737-243595104
- (regenerate fresh ones during the demo recording; the suite/agent prints a link on every buy)

## To fill in at submission (only you can)

- **Video demo URL** — record per [`DEMO.md`](DEMO.md), upload to YouTube (unlisted) or Loom.
- **Team member name(s) + email(s)** and the **nominated payee** for the prize.
- **Five developer-experience ratings (1–10)** — Hedera docs, getting help, SDK intuitiveness, debugging, likelihood to build again — answer honestly from your own experience.

## Judging-criteria coverage

- **Working end-to-end flow** — `GET → 402 → sign → pay → settle → mirror-confirm → deliver`, proven on testnet (`docs/p1-proof.md`).
- **Genuine on-chain x402 payments** — native TransferTransaction, exact scheme, every purchase a real testnet tx with a HashScan link.
- **Effective use of Hedera infrastructure** — TransferTransaction + Mirror Node settlement oracle + fee-payer sponsorship; the Mirror-Node gate is the security differentiator.
