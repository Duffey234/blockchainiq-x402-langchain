// One real paid call through the LangChain tool. Spends real USDC on Base.
//   AGENT_PRIVATE_KEY=0x... npm run paid-call                 -> brief, $0.01
//   AGENT_PRIVATE_KEY=0x... npm run paid-call -- event-risk   -> event-risk, $0.05
// Use a dedicated wallet holding a few cents of USDC on Base; it needs no ETH (settlement is gasless).
// No LLM key needed: the tool is invoked directly, exactly as a model's tool call would invoke it.
import { privateKeyToAccount } from "viem/accounts";
import { blockchainIQTools } from "../src/index.js";

const key = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set AGENT_PRIVATE_KEY to a 0x-prefixed private key of a wallet holding USDC on Base.");
  process.exit(2);
}
const which = (process.argv[2] ?? "brief").toLowerCase();
if (!["brief", "event-risk"].includes(which)) {
  console.error("Usage: npm run paid-call -- [brief|event-risk]");
  process.exit(2);
}

const signer = privateKeyToAccount(key);
const [brief, eventRisk] = blockchainIQTools({ signer, maxUsdPerCall: Number(process.env.MAX_USD_PER_CALL ?? 0.06) });
console.log(`payer ${signer.address} -> ${which === "brief" ? brief.name : eventRisk.name}`);
const out = JSON.parse(which === "brief" ? await brief.invoke({}) : await eventRisk.invoke({}));
if (out.data !== undefined) console.log(JSON.stringify(out.data, null, 2).slice(0, 2000));
console.log("\nproof of settlement:", JSON.stringify(out.settlement ?? null));
if (out.explorer) console.log("transaction:", out.explorer);
if (!out.ok) {
  console.error("call failed:", out.error);
  process.exit(1);
}
