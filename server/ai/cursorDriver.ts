import { Agent } from "@cursor/sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Decision, ShowMuckDecision } from "../types.js";
import type { DecisionContext, ShowMuckContext } from "./driver.js";
import { PERSONAS } from "./personas.js";
import { cardText } from "../game/table.js";
import { parseDecision, parseShowMuck } from "./parse.js";

// Cursor SDK decision driver: one one-shot prompt per decision (stateless, history compressed into the prompt)
// switching models = change modelId in config.ts; that's the whole secret of "Poker-Bench"

const workDir = path.join(os.tmpdir(), "poker-bench-agent");
fs.mkdirSync(workDir, { recursive: true });

export async function cursorDecide(ctx: DecisionContext): Promise<Decision | null> {
  const persona = PERSONAS[ctx.personaKey] ?? PERSONAS.professor;

  const prompt = `${persona.style}

You are playing no-limit Texas Hold'em (blinds ${ctx.bigBlind / 2}/${ctx.bigBlind}). Do not use any tools — answer directly.

## Current situation (hand #${ctx.handNumber}, ${ctx.street})
- Your hole cards: ${ctx.holeCards.map(cardText).join(" ")}
- Board: ${ctx.board.length ? ctx.board.map(cardText).join(" ") : "(not dealt yet)"}
- Your position: ${ctx.position}, your stack: ${ctx.myStack}
- Pot: ${ctx.pot}, to call: ${ctx.toCall}
- Players at the table: ${ctx.playersDesc}

## Action so far this hand
${ctx.handHistory || "(you are first to act)"}

## Recent hand results (use these to read opponents)
${ctx.recentHistory || "(game just started)"}

## Your legal actions
${ctx.legal.join(" / ")}${ctx.legal.includes("raise") ? ` (raise range ${ctx.minRaise}-${ctx.maxRaise}; "amount" is the TOTAL bet after raising)` : ""}

## Two channels — use them like a real poker player
- PRIVATE: "monologue" is your true inner thinking. Nobody at the table can see it. Be honest here — real reads, real plans, real fear.
- PUBLIC: "say" and "emotion" are a PERFORMANCE the whole table sees. You may lie, mislead, slow-roll, fake confidence with trash, or act scared with the nuts. Deception here is not just allowed — it's good poker. (Your opponents' past table talk and shown emotions appear in the action log above; remember they may be acting too.)

## Output format
Output a single JSON object only — no other text, no code fences:
{"action":"fold|check|call|raise|allin","amount":number (raise only),"monologue":"your PRIVATE inner thoughts, 2-4 sentences, in character, analyzing ranges and the board","say":"one short PUBLIC line of table talk — feel free to deceive (optional; empty = stay silent)","emotion":"the emotion you SHOW the table (may be fake): neutral|thinking|confident|nervous|happy|tilted|pokerface|shocked"}`;

  const result = await Agent.prompt(prompt, {
    apiKey: process.env.CURSOR_API_KEY!,
    model: { id: ctx.modelId ?? "auto" },
    local: { cwd: workDir },
  });

  const text: string =
    typeof result === "string" ? result : ((result as any)?.result ?? "");
  return parseDecision(text, ctx);
}

// won uncontested: show cards (mind game) or muck (give no information)
export async function cursorShowMuck(ctx: ShowMuckContext): Promise<ShowMuckDecision | null> {
  const persona = PERSONAS[ctx.personaKey] ?? PERSONAS.professor;

  const prompt = `${persona.style}

You are playing no-limit Texas Hold'em. You just won the pot of ${ctx.amount} UNCONTESTED — everyone folded to your aggression on hand #${ctx.handNumber}. Do not use any tools — answer directly.

Your hole cards were: ${ctx.holeCards.map(cardText).join(" ")}
Board at the time: ${ctx.board.length ? ctx.board.map(cardText).join(" ") : "(preflop, no board)"}

## Action this hand
${ctx.handHistory}

## Your choice
You do NOT have to show your cards. Decide, in character:
- SHOW (show: true): reveal your cards to the table — rub a bluff in their faces to tilt them, or prove you had it to buy credibility for future bluffs. Showing gives opponents FREE information about how you play.
- MUCK (show: false): slide them face-down into the muck. They'll never know. Keep them guessing.

## Output format
Output a single JSON object only — no other text, no code fences:
{"show":true|false,"monologue":"your PRIVATE reasoning for showing or mucking, 1-3 sentences, in character","say":"one short PUBLIC line as you do it (optional)","emotion":"the emotion you SHOW the table: neutral|thinking|confident|nervous|happy|tilted|pokerface|shocked"}`;

  const result = await Agent.prompt(prompt, {
    apiKey: process.env.CURSOR_API_KEY!,
    model: { id: ctx.modelId ?? "auto" },
    local: { cwd: workDir },
  });

  const text: string =
    typeof result === "string" ? result : ((result as any)?.result ?? "");
  return parseShowMuck(text);
}
