# P1 Proof-of-Life — live Hedera testnet round-trips

Date: 2026-07-21. All three are real `TransferTransaction`s settled on Hedera testnet via the x402
`exact` scheme (buyer signs, facilitator fee-payer co-signs + submits), confirmed on the Mirror Node.

| File bought | TransactionId | HashScan | Result |
|---|---|---|---|
| btc-ohlc-1h | `0.0.9674959@1784661723.935673110` | [link](https://hashscan.io/testnet/transaction/0.0.9674959-1784661723-935673110) | SUCCESS |
| eth-orderbook | `0.0.9674959@1784661729.418068069` | [link](https://hashscan.io/testnet/transaction/0.0.9674959-1784661729-418068069) | SUCCESS |
| hbar-metrics | `0.0.9674959@1784661737.243595104` | [link](https://hashscan.io/testnet/transaction/0.0.9674959-1784661737-243595104) | SUCCESS |

Per transaction (mirror-confirmed transfers):

- buyer `0.0.9651375` : **−0.1 ℏ** (pays for the data file)
- server / payTo `0.0.9674958` : **+0.1 ℏ** (receives payment)
- facilitator `0.0.9674959` : **−0.0029 ℏ** (sponsors the network fee only — the buyer pays no gas)

This is the intended x402-on-Hedera economics: the buyer pays for the resource, the facilitator
fee-payer sponsors the network fee. The end-to-end flow — `GET → 402 → sign → pay → deliver` — works.

> Note: the library's `createHederaVerifyPayerSignature` does a single un-retried Mirror Node fetch of
> the payer key; one transient blip produced a spurious `signature_invalid` in an early run. P2 wraps
> verify with a bounded retry. 3/3 clean once past that.
