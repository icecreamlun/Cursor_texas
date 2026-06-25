// cost estimate: play N real hands, accumulate token usage on both sides, convert to per-hand / 30-hand / hourly cost
// usage: COST_HANDS=3 npx tsx server/costReport.ts
import { GameRoom } from "./game/loop.js";
import { TABLE } from "./config.js";
import { codexUsage } from "./ai/codexDriver.js";
import { anthropicUsage } from "./ai/anthropicDriver.js";

TABLE.interHandDelayMs = 100;
TABLE.aiMinThinkMs = 0;
TABLE.interTurnDelayMs = 0;

// Anthropic pricing (official): Opus 4.7/4.8 = $5/Mtok input, $25/Mtok output
const OPUS_IN = 5 / 1e6;
const OPUS_OUT = 25 / 1e6;
// I won't guess at OpenAI gpt-5.x unit prices; give a range using conservative placeholder prices, see the OpenAI usage dashboard for real numbers
const GPT_IN_LO = 1.25 / 1e6, GPT_IN_HI = 2.5 / 1e6;   // placeholder: input
const GPT_OUT_LO = 10 / 1e6, GPT_OUT_HI = 10 / 1e6;     // placeholder: output

const HANDS = Number(process.env.COST_HANDS ?? 3);
const room = new GameRoom();
room.started = true;

const origPlayHand = (room as any).playHand.bind(room);
let played = 0;
(room as any).playHand = async function () {
  await origPlayHand();
  if (++played >= HANDS) finishAndReport();
};

function usd(n: number) {
  return "$" + n.toFixed(4);
}

function finishAndReport() {
  const cx = codexUsage, an = anthropicUsage;
  const opusOut = an.output;
  const opusCost = an.input * OPUS_IN + opusOut * OPUS_OUT;
  // GPT: reasoning is billed as output
  const gptOut = cx.output + cx.reasoning;
  const gptLo = cx.input * GPT_IN_LO + gptOut * GPT_OUT_LO;
  const gptHi = cx.input * GPT_IN_HI + gptOut * GPT_OUT_HI;

  const totLo = opusCost + gptLo, totHi = opusCost + gptHi;
  const perHandLo = totLo / HANDS, perHandHi = totHi / HANDS;

  const line = (s: string) => console.log(s);
  line(`\n================ Cost estimate (${HANDS} hands) ================`);
  line(`OpenAI/Codex (gpt-5.5 + gpt-5.4):  ${cx.calls} calls`);
  line(`  input ${cx.input.toLocaleString()} tok (cached ${cx.cachedInput.toLocaleString()}) | output ${cx.output.toLocaleString()} + reasoning ${cx.reasoning.toLocaleString()}`);
  line(`Anthropic/Opus (4.8 + 4.7):        ${an.calls} calls`);
  line(`  input ${an.input.toLocaleString()} tok | output ${an.output.toLocaleString()}`);
  line(`------------------------------------------------------`);
  line(`Anthropic cost (exact):            ${usd(opusCost)}`);
  line(`OpenAI cost (placeholder range):   ${usd(gptLo)} ~ ${usd(gptHi)}   ← see platform.openai.com usage for real numbers`);
  line(`Total (${HANDS} hands):              ${usd(totLo)} ~ ${usd(totHi)}`);
  line(`------------------------------------------------------`);
  line(`Per hand:         ${usd(perHandLo)} ~ ${usd(perHandHi)}`);
  line(`Per round (30 hands): ${usd(perHandLo * 30)} ~ ${usd(perHandHi * 30)}`);
  line(`Per hour (~40 hands): ${usd(perHandLo * 40)} ~ ${usd(perHandHi * 40)}`);
  line(`======================================================\n`);
  process.exit(0);
}

room.run().catch((e) => {
  console.error("cost run failed:", e);
  process.exit(1);
});
