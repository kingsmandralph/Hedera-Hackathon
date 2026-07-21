# P3 — Foolproof suite (T1–T4 attack/defend)

Run: `bash scripts/foolproof.sh` — every attack runs against a live Hedera testnet, once against the
hardened server (must BLOCK) and once against the naive server (must LEAK). All assertions pass.

## Threats

| ID | Attack | Naive server (= the reference behaviour) | Hardened control |
|----|--------|------------------------------------------|------------------|
| **T1** | Deliver-before-settle race (facilitator settle dropped) | delivers the file, `onchainSettled=false` → free data | mirror-node settle-before-deliver → 402 |
| **T2** | Replay the same settled payload | delivers again (200) | durable atomic single-use `txId` claim → 409 |
| **T3** | Underpayment (sign a transfer below price) | — | net-balance check on the signed tx → 402 `amount_too_low` |
| **T4** | Cross-file reuse (pay for A, unlock B) | delivers B | `txId` consumed globally → 409 |

## Result (all PASS)

```
SCENARIO A — HARDENED server, honest facilitator  (attacks must BLOCK)
PASS  T2-replay     first=200 replay=409
PASS  T3-underpay   paid=1tinybars status=402 amount_too_low
PASS  T4-crossfile  paidFor=hbar-metrics(200) reuseOn=btc-ohlc-1h(409)

SCENARIO B — NAIVE server, FAULTY facilitator  (race must LEAK)
PASS  T1-race    status=200 onchainSettled=false tx=(never landed)   <- FREE DATA
PASS  T2-replay  first=200 replay=200                                <- REPLAYABLE

SCENARIO C — HARDENED server, FAULTY facilitator  (race must BLOCK)
PASS  T1-race    status=402 onchainSettled=false tx=(never landed)   <- BLOCKED
```

Scenario B is the reference's documented vulnerability, reproduced. Scenario C is settle402 closing it.

## Notes / honest scope

- The **facilitator-trust** fix (server uses the `TransactionId` it extracts from the buyer's own signed
  payload, never the facilitator's returned id) is enforced architecturally in `server/src/index.ts`; a
  dedicated lying-facilitator test would need a malicious-facilitator mode (future work).
- Concurrent double-spend is handled by the exclusive-create atomic claim; the suite exercises the
  sequential replay path.
- Content-key leakability (a paying buyer can redistribute decrypted bytes) is inherent to symmetric-key
  release and documented as a residual risk in the design spec.
