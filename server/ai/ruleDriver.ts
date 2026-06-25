import type { Decision, Emotion } from "../types.js";
import type { DecisionContext } from "./driver.js";
import { PERSONAS } from "./personas.js";

// Rule-based fallback driver: simple but legal decisions + canned monologues.
// Use cases: 1) dev/demo when no Cursor key is available 2) fallback when the SDK times out / parsing fails

const RANK_VAL: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

// Rough starting-hand strength 0-1 (simplified Chen formula)
function preflopStrength(cards: { rank: string; suit: string }[]): number {
  const [a, b] = cards;
  const hi = Math.max(RANK_VAL[a.rank], RANK_VAL[b.rank]);
  const lo = Math.min(RANK_VAL[a.rank], RANK_VAL[b.rank]);
  let score = hi / 14;
  if (a.rank === b.rank) score = Math.min(1, 0.5 + hi / 20); // pair
  if (a.suit === b.suit) score += 0.06;
  const gap = hi - lo;
  if (gap === 1) score += 0.05;
  else if (gap > 3) score -= 0.08 * (gap - 3);
  return Math.max(0, Math.min(1, score));
}

// Postflop: no real evaluation, approximate with pot odds + persona randomness
function postflopStrength(seed: number): number {
  // Pseudo-random from seat+hand number, stable within the same hand
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const MONOLOGUES: Record<string, Record<string, string[]>> = {
  aggressive: {
    raise: ["That bet tells no convincing story. Time to fight back — raise and apply pressure!", "This board is way too dry for his range. I'm repping the strong hand. Fire!"],
    call: ["The odds are there. I'll call and see what story he tells next.", "I don't believe he hit. Call now, punish him on the turn."],
    check: ["I'll check this one and dig him a little trap.", "Slow-play it. Let him do the shooting."],
    fold: ["This board just doesn't cooperate. Strategic retreat.", "Fine — saving my chips for a bigger pot."],
  },
  passive: {
    raise: ["This hand is strong enough. I must raise for value.", "By the math, raising here is clearly +EV."],
    call: ["Pot odds are right. Flat call.", "Medium strength — control the pot, just call."],
    check: ["No reason to bet. Check.", "A free card? I'll gladly take it."],
    fold: ["Outside my opening range. Fold and wait.", "Playing this hand is burning money. Fold."],
  },
};

export function ruleDecide(ctx: DecisionContext): Decision {
  const persona = PERSONAS[ctx.personaKey] ?? PERSONAS.professor;
  const { legal, holeCards, street, pot, toCall, minRaise, maxRaise, handNumber, seat } = ctx;

  const strength =
    street === "preflop"
      ? preflopStrength(holeCards)
      : postflopStrength(handNumber * 100 + seat) * 0.5 + preflopStrength(holeCards) * 0.5;

  const agg = persona.aggression;
  const loose = persona.looseness;
  const canRaise = legal.includes("raise") && maxRaise > 0;

  let action: Decision["action"] = "check";
  let amount: number | undefined;

  const wantRaise = strength > 0.72 - agg * 0.25 && canRaise;
  const wantCall = toCall > 0 && (strength > 0.45 - loose * 0.2 || toCall <= pot * 0.15);

  if (wantRaise) {
    action = "raise";
    const target = Math.round(minRaise + (pot * (0.5 + agg)) / 10) * 10;
    amount = Math.min(Math.max(target, minRaise), maxRaise);
  } else if (toCall > 0) {
    action = wantCall && legal.includes("call") ? "call" : "fold";
  } else {
    action = legal.includes("check") ? "check" : "fold";
  }

  const moodKey = agg > 0.55 ? "aggressive" : "passive";
  const lines = MONOLOGUES[moodKey][action] ?? MONOLOGUES[moodKey].raise;
  const monologue = lines[(handNumber + seat) % lines.length];

  const emotion: Emotion =
    action === "raise" ? "confident" : action === "fold" ? "pokerface" : strength > 0.6 ? "happy" : "neutral";

  return { action, amount, monologue, emotion };
}
