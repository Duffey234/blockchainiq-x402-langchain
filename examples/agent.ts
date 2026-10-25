// Optional: a tool-calling chat model that decides when to buy data. Needs an LLM key as well,
// e.g. npm i @langchain/openai && OPENAI_API_KEY=... AGENT_PRIVATE_KEY=0x... node dist/examples/agent.js
// Not needed for the paid-call proof; kept dependency-free by importing the model package dynamically.
import { privateKeyToAccount } from "viem/accounts";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { blockchainIQTools } from "../src/index.js";

const key = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
const tools: StructuredToolInterface[] = [...blockchainIQTools({ signer: privateKeyToAccount(key), maxUsdPerCall: 0.02 })]; // cap: brief only
const modPath = "@langchain/openai";
const { ChatOpenAI } = (await import(modPath)) as any;
const llm = new ChatOpenAI({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" }).bindTools(tools);

const messages: any[] = [new HumanMessage("Give me a two-line crypto market read for today with any event risk in the next 48 hours.")];
for (let i = 0; i < 3; i++) {
  const ai = await llm.invoke(messages);
  messages.push(ai);
  if (!ai.tool_calls?.length) {
    console.log(ai.content);
    break;
  }
  for (const call of ai.tool_calls) {
    const t = tools.find((x) => x.name === call.name)!;
    const msg = (await t.invoke(call)) as ToolMessage;
    console.log("tool", call.name, "settlement:", JSON.parse(String(msg.content)).settlement);
    messages.push(msg);
  }
}
