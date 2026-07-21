// settle402 resource server — pay-to-read data marketplace.
// Public GET /catalog; payment-gated GET /files/:id via x402 "exact" scheme on Hedera testnet.
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { loadRootEnv, requireEnv, optionalEnv, tinybarsToHbar } from "@settle402/shared";

loadRootEnv();

const NETWORK = "hedera:testnet";
const PAY_TO = requireEnv("SERVER_ACCOUNT_ID");
const FACILITATOR_URL = optionalEnv("FACILITATOR_URL", "http://localhost:4020");
const PORT = Number(optionalEnv("SERVER_PORT", "4021"));
const NAIVE = optionalEnv("NAIVE_MODE", "false") === "true";
const PRICE_TINYBARS = optionalEnv("FILE_PRICE_TINYBARS", "10000000"); // 0.1 HBAR

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  content: unknown;
}

// P1 in-memory catalog (encryption-at-rest + single-use key release land in P2).
const CATALOG: CatalogItem[] = [
  {
    id: "btc-ohlc-1h",
    name: "BTC/USD 1h OHLC",
    description: "Latest hourly candle snapshot",
    content: { symbol: "BTC/USD", interval: "1h", o: 61250.4, h: 61480.0, l: 61010.2, c: 61390.7, v: 1843.2, ts: "2026-07-21T12:00:00Z" },
  },
  {
    id: "eth-orderbook",
    name: "ETH/USD order book (top 5)",
    description: "Level-2 depth snapshot",
    content: { symbol: "ETH/USD", bids: [[3390.1, 12.4], [3389.8, 30.0]], asks: [[3390.6, 9.1], [3391.0, 22.7]], ts: "2026-07-21T12:00:05Z" },
  },
  {
    id: "hbar-metrics",
    name: "HBAR network metrics",
    description: "Throughput + fee snapshot",
    content: { network: "hedera:mainnet", tps: 173.4, avgFeeUsd: 0.00007, ts: "2026-07-21T12:00:10Z" },
  },
];

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactHederaScheme());
await resourceServer.initialize();

const routes = {
  "GET /files/:id": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: PAY_TO,
      price: { asset: "0.0.0", amount: PRICE_TINYBARS },
      maxTimeoutSeconds: 180,
    },
  },
};

const app = new Hono();

// paymentMiddleware only gates paths present in `routes`; /catalog passes straight through.
app.use("*", paymentMiddleware(routes as never, resourceServer));

app.get("/catalog", (c) =>
  c.json({
    price: { asset: "HBAR", amountTinybars: PRICE_TINYBARS, human: tinybarsToHbar(PRICE_TINYBARS) },
    payTo: PAY_TO,
    files: CATALOG.map(({ content: _content, ...meta }) => meta),
  }),
);

app.get("/files/:id", (c) => {
  const id = c.req.param("id");
  const item = CATALOG.find((f) => f.id === id);
  if (!item) return c.json({ error: "not found" }, 404);
  return c.json({ id: item.id, name: item.name, content: item.content });
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[server] :${PORT} payTo=${PAY_TO} naive=${NAIVE} facilitator=${FACILITATOR_URL}`);
