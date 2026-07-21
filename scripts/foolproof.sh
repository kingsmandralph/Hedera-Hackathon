#!/usr/bin/env bash
# settle402 "foolproof" suite — runs the T1–T4 attacks against the hardened server (must BLOCK)
# and against the naive server (must LEAK), all on live Hedera testnet.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "building..."; npm run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }

FAC=0; SRV=0
start_fac() { FAULTY_MODE="$1" node packages/facilitator/dist/index.js >/tmp/s402-fac.log 2>&1 & FAC=$!; curl -s --retry 40 --retry-delay 1 --retry-all-errors http://localhost:4020/supported -o /dev/null; }
start_srv() { NAIVE_MODE="$1" node packages/server/dist/index.js >/tmp/s402-srv.log 2>&1 & SRV=$!; curl -s --retry 40 --retry-delay 1 --retry-all-errors http://localhost:4021/catalog -o /dev/null; }
stop() { kill "$FAC" "$SRV" 2>/dev/null; wait "$FAC" "$SRV" 2>/dev/null; }
trap stop EXIT

echo; echo "=================================================================="
echo " SCENARIO A — HARDENED server, honest facilitator  (attacks must BLOCK)"
echo "=================================================================="
rm -rf .data; start_fac false; start_srv false
node packages/agent/dist/attacks.js replay    block btc-ohlc-1h
node packages/agent/dist/attacks.js underpay  block eth-orderbook 1
node packages/agent/dist/attacks.js crossfile block hbar-metrics btc-ohlc-1h
stop

echo; echo "=================================================================="
echo " SCENARIO B — NAIVE server, FAULTY facilitator  (race must LEAK)"
echo "=================================================================="
rm -rf .data; start_fac true; start_srv true
node packages/agent/dist/attacks.js race leak btc-ohlc-1h
node packages/agent/dist/attacks.js replay leak eth-orderbook
stop

echo; echo "=================================================================="
echo " SCENARIO C — HARDENED server, FAULTY facilitator  (race must BLOCK)"
echo "=================================================================="
rm -rf .data; start_fac true; start_srv false
node packages/agent/dist/attacks.js race block btc-ohlc-1h
stop

echo; echo "done."
