// model connectivity self-check: each seat sends 1 decision, validates the whole chain with minimal quota use
// verifies: both keys work / 4 model ids valid / output parses. usage: npx tsx server/checkModels.ts
import { AI_SEATS, OPENAI_ENABLED, ANTHROPIC_ENABLED } from "./config.js";
import { decide, type DecisionContext } from "./ai/driver.js";

console.log(`OpenAI/Codex: ${OPENAI_ENABLED ? "✓" : "✗"}   Anthropic/Opus: ${ANTHROPIC_ENABLED ? "✓" : "✗"}\n`);

const aiSeats = AI_SEATS.filter((s) => s.kind === "ai");
let ok = 0;

for (let i = 0; i < aiSeats.length; i++) {
  const seat = aiSeats[i];
  const ctx: DecisionContext = {
    seat: i,
    name: seat.name,
    personaKey: seat.persona ?? "professor",
    modelId: seat.modelId,
    reasoningEffort: seat.reasoningEffort,
    handNumber: 1,
    street: "preflop",
    holeCards: [
      { rank: "A", suit: "spades" },
      { rank: "K", suit: "spades" },
    ],
    board: [],
    pot: 30,
    toCall: 20,
    minRaise: 40,
    maxRaise: 2000,
    myStack: 2000,
    bigBlind: 20,
    legal: ["fold", "call", "raise", "allin"],
    position: "BTN (dealer)",
    playersDesc: "you are first to act",
    handHistory: "",
    recentHistory: "",
  };

  const t0 = Date.now();
  const d = await decide(ctx);
  const ms = Date.now() - t0;
  const usedRule = d.monologue.startsWith("(connection's spotty");
  if (usedRule) {
    console.log(`✗ ${seat.name.padEnd(14)} ${String(seat.modelId).padEnd(18)} → rule fallback (${ms}ms) — call failed, see error above`);
  } else {
    ok++;
    console.log(`✓ ${seat.name.padEnd(14)} ${String(seat.modelId).padEnd(18)} → ${d.action}${d.amount ? " " + d.amount : ""}  (${ms}ms)  "${d.say ?? d.monologue.slice(0, 40)}"`);
  }
}

console.log(`\n${ok}/${aiSeats.length} seats have a working live-model chain.`);
process.exit(ok === aiSeats.length ? 0 : 1);
