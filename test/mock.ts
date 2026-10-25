// Mock Blockchain IQ server for tests: real 402 headers captured from the live API (no payment made),
// a fake settlement on the paid retry. Nothing here touches the network or moves money.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Works from test/ (ts) and dist/test/ (compiled): fixtures live in <repo>/test/fixtures.
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = here.includes(`${"dist"}`) ? join(here, "..", "..", "test", "fixtures") : join(here, "fixtures");
export const BRIEF_402 = readFileSync(join(fixtures, "brief-402.b64"), "utf8").trim();
export const EVENT_RISK_402 = readFileSync(join(fixtures, "event-risk-402.b64"), "utf8").trim();
export const FAKE_TX = "0x" + "ab".repeat(32);

export interface Seen {
  url: string;
  paymentSignature?: string;
}

export function decodePayment(sig: string): any {
  return JSON.parse(Buffer.from(sig, "base64").toString("utf8"));
}

export function mockBlockchainIQ(opts: { failSettle?: boolean; status?: number } = {}) {
  const seen: Seen[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input as any, init);
    const sig = req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined;
    seen.push({ url: req.url, paymentSignature: sig });
    const u = new URL(req.url);
    if (opts.status) return new Response(JSON.stringify({ error: "boom" }), { status: opts.status, headers: { "content-type": "application/json" } });
    const header = u.pathname.endsWith("/brief") ? BRIEF_402 : u.pathname.endsWith("/event-risk") ? EVENT_RISK_402 : undefined;
    if (!header) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (!sig || opts.failSettle) {
      return new Response(JSON.stringify({ error: "Payment required." }), {
        status: 402,
        headers: { "content-type": "application/json", "PAYMENT-REQUIRED": header },
      });
    }
    const payment = decodePayment(sig);
    const settlement = { success: true, transaction: FAKE_TX, network: "eip155:8453", payer: payment?.payload?.authorization?.from };
    const data = u.pathname.endsWith("/brief")
      ? { asOf: "2026-10-25T12:00:00.000Z", coins: [{ symbol: "btc", price: 100000 }], events: [], flags: [] }
      : [{ date: "2026-10-28", title: "FOMC decision", importance: 3 }];
    return new Response(JSON.stringify({ source: "Blockchain IQ", data }), {
      status: 200,
      headers: { "content-type": "application/json", "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settlement)).toString("base64") },
    });
  };
  return { impl: impl as typeof fetch, seen };
}
