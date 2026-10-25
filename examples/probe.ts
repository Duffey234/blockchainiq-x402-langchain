// Free check, no wallet, no payment: shows the live 402 price terms for brief and event-risk.
import { briefUrl, eventRiskUrl, probePrice } from "../src/x402.js";

for (const url of [briefUrl(), eventRiskUrl()]) {
  const p = await probePrice(url);
  console.log(url, JSON.stringify(p, null, 1));
}
