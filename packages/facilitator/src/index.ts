// settle402 facilitator — ECDSA fee-payer service. GET /supported, POST /verify, POST /settle.
// FAULTY_MODE verifies signatures upstream but drops settle (stages the T1 deliver-before-settle race).
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import {
  PrivateKey,
  createHederaClient,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  createHederaPreflightTransfer,
  toFacilitatorHederaSigner,
} from "@x402/hedera";
import { loadRootEnv, requireEnv, optionalEnv, stripHexPrefix } from "@settle402/shared";

loadRootEnv();

const NETWORK = "hedera:testnet";
const FACILITATOR_ID = requireEnv("FACILITATOR_ACCOUNT_ID");
const feePayerKey = PrivateKey.fromStringECDSA(stripHexPrefix(requireEnv("FACILITATOR_PRIVATE_KEY")));
const FAULTY = optionalEnv("FAULTY_MODE", "false") === "true";
const PORT = Number(optionalEnv("FACILITATOR_PORT", "4020"));

const facSigner = toFacilitatorHederaSigner({
  getAddresses() {
    return [FACILITATOR_ID];
  },
  signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
    (net: string) => createHederaClient(net),
    feePayerKey,
  ),
  verifyPayerSignature: createHederaVerifyPayerSignature(),
  preflightTransfer: createHederaPreflightTransfer(),
});

const facilitator = new x402Facilitator().register(NETWORK, new ExactHederaScheme(facSigner));

const app = new Hono();

app.get("/supported", (c) => c.json(facilitator.getSupported()));

app.post("/verify", async (c) => {
  const { paymentPayload, paymentRequirements } = await c.req.json();
  const result = await facilitator.verify(paymentPayload, paymentRequirements);
  if (!result.isValid) console.log(`[verify] rejected: ${result.invalidReason} (${result.invalidMessage ?? ""})`);
  return c.json(result);
});

app.post("/settle", async (c) => {
  const { paymentPayload, paymentRequirements } = await c.req.json();
  if (FAULTY) {
    // The application-layer race: signature verifies, but the transfer is never submitted to Hedera.
    return c.json({
      success: false,
      errorReason: "faulty_mode_settle_dropped",
      errorMessage: "FAULTY_MODE: settle intentionally not submitted",
      transaction: "",
      network: NETWORK,
    });
  }
  const result = await facilitator.settle(paymentPayload, paymentRequirements);
  return c.json(result);
});

serve({ fetch: app.fetch, port: PORT });
console.log(`[facilitator] :${PORT} feePayer=${FACILITATOR_ID} faulty=${FAULTY}`);
