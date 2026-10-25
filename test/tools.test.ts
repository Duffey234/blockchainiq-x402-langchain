import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { blockchainIQTools, blockchainIQBriefTool, BASE_USDC } from "../src/index.js";
import { mockBlockchainIQ, decodePayment, FAKE_TX } from "./mock.js";

// Fully offline: any unexpected network call fails the test.
globalThis.fetch = (async (input: RequestInfo | URL) => {
  throw new Error(`unexpected network call in tests: ${String(input)}`);
}) as typeof fetch;

const PAY_TO = "0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e";
const signer = privateKeyToAccount(generatePrivateKey()); // throwaway, unfunded

function tools(fetchImpl: typeof fetch, maxUsdPerCall?: number) {
  const [brief, eventRisk] = blockchainIQTools({ signer, fetchImpl, maxUsdPerCall });
  return { brief, eventRisk };
}

test("exposes two LangChain tools with JSON schemas", () => {
  const { brief, eventRisk } = tools(mockBlockchainIQ().impl);
  assert.equal(brief.name, "blockchainiq_market_brief");
  assert.equal(eventRisk.name, "blockchainiq_event_risk");
  assert.match(brief.description, /\$0\.01/);
  assert.match(eventRisk.description, /\$0\.05/);
});

test("brief: 402 -> signs exact USDC payment of 10000 (0.01) to Blockchain IQ on Base -> data + tx hash", async () => {
  const m = mockBlockchainIQ();
  const out = JSON.parse(await tools(m.impl).brief.invoke({}));
  assert.equal(out.ok, true);
  assert.equal(out.settlement.transaction, FAKE_TX);
  assert.equal(out.explorer, `https://basescan.org/tx/${FAKE_TX}`);
  assert.equal(out.data.coins[0].symbol, "btc");
  assert.equal(m.seen.length, 2);
  assert.equal(m.seen[0].paymentSignature, undefined);
  const p = decodePayment(m.seen[1].paymentSignature!);
  assert.equal(p.x402Version, 2);
  assert.equal(p.accepted.scheme, "exact");
  assert.equal(p.accepted.network, "eip155:8453");
  assert.equal(p.accepted.asset, BASE_USDC);
  assert.equal(p.accepted.amount, "10000");
  assert.equal(p.payload.authorization.from.toLowerCase(), signer.address.toLowerCase());
  assert.equal(p.payload.authorization.to.toLowerCase(), PAY_TO.toLowerCase());
  assert.equal(p.payload.authorization.value, "10000");
  assert.match(p.payload.signature, /^0x[0-9a-f]{130}$/i);
});

test("event-risk: forwards days/minImportance, pays 50000 (0.05)", async () => {
  const m = mockBlockchainIQ();
  const out = JSON.parse(await tools(m.impl).eventRisk.invoke({ days: 30, minImportance: 2 }));
  assert.equal(out.ok, true);
  assert.equal(new URL(m.seen[1].url).search, "?days=30&minImportance=2");
  assert.equal(decodePayment(m.seen[1].paymentSignature!).accepted.amount, "50000");
});

test("works as a model tool call (ToolCall in -> ToolMessage out)", async () => {
  const m = mockBlockchainIQ();
  const msg: any = await tools(m.impl).brief.invoke({ id: "call_1", name: "blockchainiq_market_brief", args: {}, type: "tool_call" });
  assert.equal(msg.tool_call_id, "call_1");
  assert.equal(JSON.parse(msg.content).settlement.transaction, FAKE_TX);
});

test("schema rejects bad input before any request", async () => {
  const m = mockBlockchainIQ();
  await assert.rejects(() => tools(m.impl).eventRisk.invoke({ days: 365 }));
  await assert.rejects(() => tools(m.impl).eventRisk.invoke({ minImportance: 5 }));
  assert.equal(m.seen.length, 0);
});

test("spend cap: refuses $0.05 when capped at $0.02, nothing signed", async () => {
  const m = mockBlockchainIQ();
  const out = JSON.parse(await tools(m.impl, 0.02).eventRisk.invoke({}));
  assert.equal(out.ok, false);
  assert.match(out.error, /maxAmountPerPayment|spend/i);
  assert.equal(m.seen.filter((s) => s.paymentSignature).length, 0);
});

test("payment refused by server -> ok:false, no data", async () => {
  const m = mockBlockchainIQ({ failSettle: true });
  const out = JSON.parse(await blockchainIQBriefTool({ signer, fetchImpl: m.impl }).invoke({}));
  assert.equal(out.ok, false);
  assert.equal(out.status, 402);
  assert.match(out.error, /payment not accepted/);
  assert.equal(out.data, undefined);
});

test("server error surfaced, never paid", async () => {
  const m = mockBlockchainIQ({ status: 503 });
  const out = JSON.parse(await tools(m.impl).brief.invoke({}));
  assert.equal(out.ok, false);
  assert.equal(out.status, 503);
  assert.equal(m.seen.filter((s) => s.paymentSignature).length, 0);
});
