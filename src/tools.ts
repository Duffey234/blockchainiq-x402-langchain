// LangChain.js tools for the Blockchain IQ x402 API. Each tool call pays per request in USDC on Base
// (x402 v2, @x402/fetch + ExactEvmScheme). Bind them to any tool-calling chat model or agent.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { BLOCKCHAINIQ_API, DEFAULT_MAX_USD_PER_CALL, briefUrl, createPaidFetch, eventRiskUrl, paidGet, type X402Signer } from "./x402.js";

export interface BlockchainIQToolsOptions {
  /** Signs the USDC payment: a viem LocalAccount, e.g. privateKeyToAccount(process.env.AGENT_PRIVATE_KEY). */
  signer: X402Signer;
  /** Refuse any single payment above this many US dollars. Default 0.06 (event-risk is $0.05). */
  maxUsdPerCall?: number;
  /** Override the API base URL (tests). */
  baseUrl?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

export const briefSchema = z.object({});
export const eventRiskSchema = z.object({
  days: z.number().int().min(1).max(90).optional().describe("How many days ahead to look, 1-90 (default 7)"),
  minImportance: z.number().int().min(1).max(3).optional().describe("Only events at or above this importance: 1 = everything, 3 = only market-moving"),
});

export function blockchainIQBriefTool(opts: BlockchainIQToolsOptions) {
  const pay = createPaidFetch({ signer: opts.signer, maxUsdPerCall: opts.maxUsdPerCall ?? DEFAULT_MAX_USD_PER_CALL, fetchImpl: opts.fetchImpl });
  const base = opts.baseUrl ?? BLOCKCHAINIQ_API;
  return tool(async () => JSON.stringify(await paidGet(pay, "brief", briefUrl(base))), {
    name: "blockchainiq_market_brief",
    description:
      "Buys the Blockchain IQ crypto market brief for $0.01 USDC on Base (x402). Returns BTC, ETH, SOL and XRP prices with 24h/7d/30d moves and rank, scheduled macro and crypto events in the next 48 hours, and short risk flags. Use as the opening call of a trading, portfolio or research task. No input. Market data only, not investment advice.",
    schema: briefSchema,
  });
}

export function blockchainIQEventRiskTool(opts: BlockchainIQToolsOptions) {
  const pay = createPaidFetch({ signer: opts.signer, maxUsdPerCall: opts.maxUsdPerCall ?? DEFAULT_MAX_USD_PER_CALL, fetchImpl: opts.fetchImpl });
  const base = opts.baseUrl ?? BLOCKCHAINIQ_API;
  return tool(
    async (args) => {
      let url: string;
      try {
        url = eventRiskUrl(args, base);
      } catch (e) {
        return JSON.stringify({ ok: false, status: 0, resource: "event-risk", error: (e as Error).message });
      }
      return JSON.stringify(await paidGet(pay, "event-risk", url));
    },
    {
      name: "blockchainiq_event_risk",
      description:
        "Buys Blockchain IQ's event-risk calendar for $0.05 USDC on Base (x402). Returns scheduled market-moving events (US data releases with times, FOMC/ECB/BoJ decisions, Treasury auctions, crypto and regulatory milestones) for the next 7 days by default, each with importance 1-3 and its official source. Use before any trade or scheduled action.",
      schema: eventRiskSchema,
    },
  );
}

/** Both tools, sharing one signer and spend cap. */
export function blockchainIQTools(opts: BlockchainIQToolsOptions) {
  return [blockchainIQBriefTool(opts), blockchainIQEventRiskTool(opts)] as const;
}
