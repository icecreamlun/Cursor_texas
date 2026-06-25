import Anthropic from "@anthropic-ai/sdk";
import type { Decision, ShowMuckDecision } from "../types.js";
import type { DecisionContext, ShowMuckContext } from "./driver.js";
import { PERSONAS } from "./personas.js";
import { cardText } from "../game/table.js";
import { parseDecision, parseShowMuck } from "./parse.js";
import { TABLE } from "../config.js";

// Anthropic (Opus) decision driver — plan A: one persistent messages history per seat = independent memory
// - model id uses claude-opus-4-8 / claude-opus-4-7 (exact strings, no date suffix)
// - "low reasoning" → output_config.effort:"low" (budget_tokens 400s on 4.7/4.8)
// - don't pass thinking (off by default on 4.7/4.8), don't pass temperature (would 400)
// - structured output via prompt convention + regex parsing (stable on both 4.7/4.8), with rule fallback on failure

const client = new Anthropic(); // reads ANTHROPIC_API_KEY (config.ts already injected .env into process.env)

// each seat's own conversation history: accumulates its decisions and inner monologue across hands
const seatHistory = new Map<number, Anthropic.MessageParam[]>();

export function resetAnthropicMemory() {
  seatHistory.clear();
}

// token usage tally (for cost estimation)
export const anthropicUsage = { input: 0, cacheRead: 0, output: 0, calls: 0 };
function tallyAnthropic(u: Anthropic.Usage) {
  anthropicUsage.input += u.input_tokens;
  anthropicUsage.cacheRead += u.cache_read_input_tokens ?? 0;
  anthropicUsage.output += u.output_tokens;
  anthropicUsage.calls++;
}

// trim: keep only the most recent few, and ensure the first is a user message (API requires the first to be user)
const MAX_HISTORY = 40;
function trim(msgs: Anthropic.MessageParam[]) {
  if (msgs.length > MAX_HISTORY) msgs.splice(0, msgs.length - MAX_HISTORY);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
}

// effort: Anthropic's valid levels are low/medium/high/xhigh/max (no minimal)
function effortFor(ctx: { reasoningEffort?: string }): "low" | "medium" | "high" | "xhigh" | "max" {
  const e = ctx.reasoningEffort === "minimal" ? "low" : ctx.reasoningEffort;
  return (["low", "medium", "high", "xhigh", "max"].includes(e ?? "") ? e : "low") as any;
}

function systemText(personaKey: string, bigBlind: number): string {
  const persona = PERSONAS[personaKey] ?? PERSONAS.professor;
  return `${persona.style}

You are playing no-limit Texas Hold'em (blinds ${bigBlind / 2}/${bigBlind}) 6-handed against other AIs and human players, across MANY hands in ONE long session. You remember every hand you've played, your own past reasoning, and the reads you've built on each opponent — use that memory: track who bluffs, who only bets the nuts, who folds to pressure, and adapt.

## Two channels — use them like a real player
- PRIVATE: "monologue" is your true inner thinking. Nobody at the table sees it. Be honest — real reads, real plans, real fear. You DO remember your own past monologues.
- PUBLIC: "say" and "emotion" are a PERFORMANCE the whole table sees. You may lie, slow-roll, fake confidence with trash or act scared with the nuts. Deception is good poker. Opponents' past table talk and shown emotions appear in the log — they may be acting too.

## Output format
Each turn, output a SINGLE JSON object only — no other text, no code fences:
{"action":"fold|check|call|raise|allin","amount":number (raise only; TOTAL bet after raising),"monologue":"your PRIVATE inner thoughts, 2-4 sentences, in character","say":"one short PUBLIC line of table talk, may be a lie (optional)","emotion":"neutral|thinking|confident|nervous|happy|tilted|pokerface|shocked"}`;
}

function situationText(ctx: DecisionContext): string {
  return `## Hand #${ctx.handNumber} — ${ctx.street}
- Your hole cards: ${ctx.holeCards.map(cardText).join(" ")}
- Board: ${ctx.board.length ? ctx.board.map(cardText).join(" ") : "(not dealt yet)"}
- Position: ${ctx.position} | Your stack: ${ctx.myStack} | Pot: ${ctx.pot} | To call: ${ctx.toCall}
- Players: ${ctx.playersDesc}

## Action so far this hand
${ctx.handHistory || "(you are first to act)"}

## Recent results (public)
${ctx.recentHistory || "(game just started)"}

## Legal actions: ${ctx.legal.join(" / ")}${ctx.legal.includes("raise") ? ` (raise range ${ctx.minRaise}-${ctx.maxRaise}; "amount" = TOTAL bet after raising)` : ""}

Output your decision as a single JSON object now.`;
}

function textOf(content: Anthropic.Message["content"]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function historyFor(seat: number): Anthropic.MessageParam[] {
  let msgs = seatHistory.get(seat);
  if (!msgs) {
    msgs = [];
    seatHistory.set(seat, msgs);
  }
  return msgs;
}

export async function anthropicDecide(ctx: DecisionContext): Promise<Decision | null> {
  const msgs = historyFor(ctx.seat);
  msgs.push({ role: "user", content: situationText(ctx) });
  try {
    const resp = await client.messages.create(
      {
        model: ctx.modelId ?? "claude-opus-4-8",
        max_tokens: 1024,
        system: systemText(ctx.personaKey, ctx.bigBlind),
        output_config: { effort: effortFor(ctx) },
        messages: msgs,
      },
      { timeout: TABLE.aiTimeoutMs }
    );
    msgs.push({ role: "assistant", content: resp.content });
    tallyAnthropic(resp.usage);
    trim(msgs);
    return parseDecision(textOf(resp.content), ctx);
  } catch (e) {
    msgs.pop(); // remove this user message that never got paired with an assistant, keeping history valid
    throw e;
  }
}

export async function anthropicShowMuck(ctx: ShowMuckContext): Promise<ShowMuckDecision | null> {
  const msgs = historyFor(ctx.seat);
  const prompt = `## Hand #${ctx.handNumber} — you won ${ctx.amount} UNCONTESTED (everyone folded to you).
Your hole cards: ${ctx.holeCards.map(cardText).join(" ")}
Board: ${ctx.board.length ? ctx.board.map(cardText).join(" ") : "(preflop, no board)"}
Action this hand:
${ctx.handHistory}

Decide in character: SHOW your cards (rub in a bluff / build credibility, but give opponents free info) or MUCK (keep them guessing). Output a SINGLE JSON object only:
{"show":true|false,"monologue":"your PRIVATE reasoning, 1-3 sentences","say":"one short PUBLIC line (optional)","emotion":"neutral|thinking|confident|nervous|happy|tilted|pokerface|shocked"}`;
  msgs.push({ role: "user", content: prompt });
  try {
    const resp = await client.messages.create(
      {
        model: ctx.modelId ?? "claude-opus-4-8",
        max_tokens: 512,
        system: systemText(ctx.personaKey, TABLE.bigBlind),
        output_config: { effort: effortFor(ctx) },
        messages: msgs,
      },
      { timeout: 20_000 }
    );
    msgs.push({ role: "assistant", content: resp.content });
    tallyAnthropic(resp.usage);
    trim(msgs);
    return parseShowMuck(textOf(resp.content));
  } catch (e) {
    msgs.pop();
    throw e;
  }
}
