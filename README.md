# blockchainiq-langchain

[LangChain.js](https://js.langchain.com) tools for the [Blockchain IQ](https://www.blockchainiq.co/agents) x402 crypto data API.
A tool-calling model or agent can buy Blockchain IQ data one call at a time.
It pays in USDC on Base over [x402](https://x402.org) v2.
You don't need an API key or an account. The wallet is the only credential.

| Tool | Resource | Price | Returns |
| --- | --- | --- | --- |
| `blockchainiq_market_brief` | `GET /api/x402/v1/brief` | $0.01 | BTC, ETH, SOL and XRP prices with 24h, 7d and 30d moves and rank, scheduled events in the next 48 h, and risk flags |
| `blockchainiq_event_risk` | `GET /api/x402/v1/event-risk` | $0.05 | Scheduled market-moving events for the next 7 days by default (`days` 1–90, `minImportance` 1–3), each with an official source |

Each tool returns a JSON string containing:

- `ok` and `status`
- `data`: the resource's payload
- `settlement`: the decoded `PAYMENT-RESPONSE` header (`transaction`, `network`, `payer`)
- `explorer`: a Basescan link to the settlement transaction

These are standard `@langchain/core` tools built with `tool()` and zod schemas. They work with:

- `llm.bindTools(tools)`
- `createAgent({ model, tools })`
- LangGraph `ToolNode`
- direct `tool.invoke(args)` or `tool.invoke(toolCall)`, which returns a `ToolMessage`

## How a call works

1. The tool sends a plain `GET`. Blockchain IQ answers `402` with `PAYMENT-REQUIRED`: the price, USDC, Base `eip155:8453` and the `payTo` address.
2. [`@x402/fetch`](https://www.npmjs.com/package/@x402/fetch) with `ExactEvmScheme` signs an EIP-3009 USDC authorization for exactly that amount with your viem account, then retries with `PAYMENT-SIGNATURE`.
3. Blockchain IQ settles the payment and returns `200` with JSON and `PAYMENT-RESPONSE`, which carries the transaction hash. The payer needs no ETH.

**Spend cap:** a per-payment cap (`maxUsdPerCall`, default **$0.06**) is enforced by x402 `spendControls`. A price above the cap is refused before anything is signed. A 404 or an error is never charged.

## Setup

Requirements:

- Node 18 or later
- A **dedicated** wallet holding a few cents of USDC on Base. Never use a main wallet.

```bash
git clone https://agentgate-source.pages.dev/blockchainiq-x402-langchain/blockchainiq-x402-langchain.git
cd blockchainiq-x402-langchain
npm install
npm test          # offline: mocked 402 + mocked settlement, no wallet, no money
npm run probe     # free: reads the live 402 price terms for brief and event-risk, pays nothing
```

### One real paid call ($0.01), with no LLM key needed

```bash
export AGENT_PRIVATE_KEY=0x...      # dedicated wallet with >= 0.01 USDC on Base
npm run paid-call                   # brief, $0.01
npm run paid-call -- event-risk     # event-risk, $0.05
```

The command prints the data, the proof of settlement and the Basescan link:

```
payer 0xYourWallet -> blockchainiq_market_brief
{ "asOf": "...", "coins": [ ... ], "events": [ ... ], "flags": [ ... ] }

proof of settlement: {"success":true,"transaction":"0x...","network":"eip155:8453","payer":"0xYourWallet"}
transaction: https://basescan.org/tx/0x...
```

If the wallet has no USDC, the facilitator refuses the authorization. You get `payment not accepted: ... (does the paying wallet hold enough USDC on Base?)` and nothing is charged.

## Use it in your agent

```ts
import { privateKeyToAccount } from "viem/accounts";
import { ChatOpenAI } from "@langchain/openai";
import { blockchainIQTools } from "blockchainiq-langchain";

const tools = [...blockchainIQTools({
  signer: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`),
  maxUsdPerCall: 0.06,
})];
const llm = new ChatOpenAI({ model: "gpt-4o-mini" }).bindTools(tools);
```

`examples/agent.ts` is a small tool-calling loop. It needs `@langchain/openai` and `OPENAI_API_KEY`, and caps spend at $0.02, so it can only buy the brief.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `signer` | required | viem `LocalAccount` (or any signer `ExactEvmScheme` accepts) that pays |
| `maxUsdPerCall` | `0.06` | Refuse any single payment above this many dollars |
| `baseUrl` | `https://www.blockchainiq.co/api/x402/v1` | API base (tests) |
| `fetchImpl` | global `fetch` | Inject a fetch (tests) |

## Tests

`npm test` compiles with `tsc` and runs `node --test`. The suite is fully offline, and any real network call fails it:

- **Mocked API.** The mock replays the **real** `PAYMENT-REQUIRED` headers captured from the live API (`test/fixtures/*.b64`) and returns a fake settlement.
- **Real signing.** A throwaway, unfunded key really signs the EIP-3009 authorization.
- **What the tests check:**
  - The signed payment is x402 v2 `exact` on `eip155:8453`, for USDC, to Blockchain IQ's `payTo`, for exactly 10000 or 50000 base units, from the signer's address.
  - Arguments are forwarded, and the zod schema rejects bad input before any request.
  - A tool call returns a `ToolMessage`.
  - The spend cap refuses a $0.05 call when capped at $0.02.
  - Server refusals and 5xx errors are surfaced and never paid.

Market data and analysis only, not investment advice. Blockchain IQ's terms: https://www.blockchainiq.co/terms

## License

MIT
