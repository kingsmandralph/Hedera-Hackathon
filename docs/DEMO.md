# Demo script (< 5 minutes)

Target: ~4:15, leaving buffer. Pre-fund the 3 accounts; have 3 terminals + a browser tab ready.
Record with OBS; speed up the two ~10 s mirror-confirm waits in post if needed.

**Pre-roll (do NOT record):**
```bash
npm run build && rm -rf .data
# T1: facilitator honest, server hardened
node packages/facilitator/dist/index.js &     # terminal 1
node packages/server/dist/index.js &           # terminal 2
```
Open http://localhost:4021/ in the browser.

---

### 0:00 – 0:35 — The pitch
- Show the browser UI: “settle402, a pay-to-read data marketplace on Hedera using x402.”
- One line: “Every file is released only *after* payment is independently confirmed on the Hedera Mirror Node — unlike the reference, which delivers before settlement and can be cheated.”
- Point at the **`hardened`** badge and the catalog (3 data files, priced in HBAR).

### 0:35 – 1:45 — A real purchase (happy path)
- Terminal 3: `node packages/agent/dist/index.js catalog` → show the files + price.
- `node packages/agent/dist/index.js buy btc-ohlc-1h`
- Narrate the printed steps: `402 → sign TransferTransaction → pay → SETTLED tx=… → content`.
- Click the printed **HashScan** link → show the on-chain transfer: **buyer −0.1 ℏ, payTo +0.1 ℏ, facilitator pays the fee**.
- Switch to the browser UI → the **settled receipt appears** with the HashScan link. “Real HBAR, real settlement, buyer paid no gas.”

### 1:45 – 3:30 — The security differentiator (attack/defend)
- “Here’s why the gate matters.” Run the suite: `bash scripts/foolproof.sh`
- Talk over the output:
  - **Scenario A (hardened):** replay → `409`, underpayment → `402`, cross-file reuse → `409`. All blocked.
  - **Scenario B (naive server + a faulty facilitator):** T1 race → **file delivered, `onchainSettled=false`** — free data. T2 replay → delivered twice. “This is the reference’s documented bug, reproduced.”
  - **Scenario C (hardened + same faulty facilitator):** T1 race → **`402`, blocked.** “settle402 closes it.”

### 3:30 – 4:15 — Wrap
- One screen: the threat-model table in the README (T1–T4, naive leaks / hardened blocks).
- “Native Hedera TransferTransaction for payment, the Mirror Node as an independent settlement oracle, x402 exact scheme, fee-payer sponsorship. Public repo, all on testnet.”
- Show the repo URL: `github.com/kingsmandralph/Hedera-Hackathon`.

---

**Checklist before recording:** accounts funded • `npm run check:singleton` shows one SDK • one dry-run of the buy + suite • HashScan links open in a browser (HashScan is a SPA — open in browser, not curl).
