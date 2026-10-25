// Minimal x402 v2 client for the Blockchain IQ API (USDC on Base, eip155:8453).
// Wraps @x402/fetch: the first request gets HTTP 402 + PAYMENT-REQUIRED, the wrapper signs an
// EIP-3009 USDC authorization with the given signer and retries; settlement is gasless for the payer.
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";

export const BLOCKCHAINIQ_API = "https://www.blockchainiq.co/api/x402/v1";
export const BASE_MAINNET = "eip155:8453";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Default per-call cap in US dollars. brief costs $0.01 and event-risk $0.05. */
export const DEFAULT_MAX_USD_PER_CALL = 0.06;

/** Anything ExactEvmScheme accepts as a signer (a viem LocalAccount, or AgentKit's wallet.toSigner()). */
export type X402Signer = ConstructorParameters<typeof ExactEvmScheme>[0];

export interface Settlement {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  [k: string]: unknown;
}

export interface PaidResult<T = unknown> {
  ok: boolean;
  status: number;
  resource: string;
  url: string;
  data?: T;
  error?: string;
  settlement?: Settlement;
  explorer?: string;
}

export interface ClientOptions {
  signer: X402Signer;
  maxUsdPerCall?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createPaidFetch(opts: ClientOptions): typeof fetch {
  const client = x402Client.fromConfig({
    schemes: [{ network: BASE_MAINNET, client: new ExactEvmScheme(opts.signer) }],
    spendControls: { maxAmountPerPayment: opts.maxUsdPerCall ?? DEFAULT_MAX_USD_PER_CALL },
  });
  return wrapFetchWithPayment(opts.fetchImpl ?? fetch, client) as typeof fetch;
}

export function briefUrl(baseUrl = BLOCKCHAINIQ_API): string {
  return `${baseUrl}/brief`;
}

export function eventRiskUrl(args: { days?: number; minImportance?: number } = {}, baseUrl = BLOCKCHAINIQ_API): string {
  const q = new URLSearchParams();
  if (args.days !== undefined) {
    if (!Number.isInteger(args.days) || args.days < 1 || args.days > 90) throw new RangeError("days must be an integer from 1 to 90");
    q.set("days", String(args.days));
  }
  if (args.minImportance !== undefined) {
    if (![1, 2, 3].includes(args.minImportance)) throw new RangeError("minImportance must be 1, 2 or 3");
    q.set("minImportance", String(args.minImportance));
  }
  const s = q.toString();
  return `${baseUrl}/event-risk${s ? `?${s}` : ""}`;
}

/** Calls one paid resource and returns the JSON body plus the decoded proof of settlement. */
export async function paidGet<T = unknown>(paidFetch: typeof fetch, resource: string, url: string): Promise<PaidResult<T>> {
  let res: Response;
  try {
    res = await paidFetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    return { ok: false, status: 0, resource, url, error: (e as Error).message };
  }
  const out: PaidResult<T> = { ok: res.ok, status: res.status, resource, url };
  const pr = res.headers.get("payment-response");
  if (pr) {
    try {
      out.settlement = decodePaymentResponseHeader(pr) as Settlement;
      if (out.settlement.transaction) out.explorer = `https://basescan.org/tx/${out.settlement.transaction}`;
    } catch {
      /* ignore malformed header */
    }
  }
  let body: any = undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (res.ok) {
    out.data = (body && typeof body === "object" && "data" in body ? body.data : body) as T;
  } else if (res.status === 402) {
    const h = res.headers.get("payment-required");
    let reason = body?.error ?? "payment required";
    if (h) {
      try {
        reason = decodePaymentRequiredHeader(h).error ?? reason;
      } catch {
        /* ignore */
      }
    }
    out.error = `payment not accepted: ${reason}`;
    if (/revert|insufficient|balance/i.test(String(reason))) out.error += " (does the paying wallet hold enough USDC on Base?)";
  } else {
    out.error = body?.error ?? `HTTP ${res.status}`;
  }
  return out;
}

/** Free, unpaid probe: returns the price terms from the 402 without paying anything. */
export async function probePrice(url: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(url);
  if (res.status !== 402) return { status: res.status };
  const h = res.headers.get("payment-required");
  if (!h) return { status: 402 };
  const pr = decodePaymentRequiredHeader(h);
  return { status: 402, accepts: pr.accepts };
}
