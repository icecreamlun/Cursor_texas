import { Codex, type Thread } from "@openai/codex-sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Decision, ShowMuckDecision } from "../types.js";
import type { DecisionContext, ShowMuckContext } from "./driver.js";
import { PERSONAS } from "./personas.js";
import { cardText } from "../game/table.js";
import { parseDecision, parseShowMuck } from "./parse.js";
import { TABLE } from "../config.js";

// Codex SDK decision driver (plan A: one persistent thread per seat = independent memory)
// - uses OPENAI_API_KEY for API billing; preferred_auth_method forces it to ignore the local ChatGPT login
// - outputSchema makes the model emit structured JSON directly, no more regex scraping
// - sandbox locked to pure reasoning: no file read/write, no network, no command execution

const workDir = path.join(os.tmpdir(), "poker-bench-agent");
fs.mkdirSync(workDir, { recursive: true });

const codex = new Codex({
  apiKey: process.env.OPENAI_API_KEY,
  config: { preferred_auth_method: "apikey" }, // overrides ~/.codex/auth.json, for this process
});

// each seat keeps its own thread — accumulating its game history, private reads and inner monologue across hands
const seatThreads = new Map<number, { thread: Thread; introduced: boolean }>();

function getThread(seat: number, modelId?: string, effort?: string) {
  let entry = seatThreads.get(seat);
  if (!entry) {
    const thread = codex.startThread({
      model: modelId ?? "gpt-5.5",
      modelReasoningEffort: (effort as any) ?? "medium",
      sandboxMode: "read-only",
      skipGitRepoCheck: true,
      workingDirectory: workDir,
      networkAccessEnabled: false,
      webSearchEnabled: false,
      approvalPolicy: "never",
    });
    entry = { thread, introduced: false };
    seatThreads.set(seat, entry);
  }
  return entry;
}

// clear memory when the whole table restarts (called by loop.ts's doRestart)
export function resetCodexMemory() {
  seatThreads.clear();
}

// token usage tally (for cost estimation)
export const codexUsage = { input: 0, cachedInput: 0, output: 0, reasoning: 0, calls: 0 };
function tallyCodex(u: { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null) {
  if (!u) return;
  codexUsage.input += u.input_tokens;
  codexUsage.cachedInput += u.cached_input_tokens;
  codexUsage.output += u.output_tokens;
  codexUsage.reasoning += u.reasoning_output_tokens;
  codexUsage.calls++;
}

const EMOTIONS = [
  "neutral", "thinking", "confident", "nervous", "happy", "tilted", "pokerface", "shocked",
];

// OpenAI strict structured output: required must include every key in properties; optional fields expressed via nullable
const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "amount", "monologue", "say", "emotion"],
  properties: {
    action: { type: "string", enum: ["fold", "check", "call", "raise", "allin"] },
    amount: { type: ["number", "null"], description: "raise only: TOTAL bet after raising; null otherwise" },
    monologue: { type: "string", description: "PRIVATE inner thoughts, 2-4 sentences, in character" },
    say: { type: ["string", "null"], description: "one short PUBLIC line of table talk (may be a lie); null = silent" },
    emotion: { type: "string", enum: EMOTIONS },
  },
} as const;

const SHOWMUCK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["show", "monologue", "say", "emotion"],
  properties: {
    show: { type: "boolean" },
    monologue: { type: "string" },
    say: { type: ["string", "null"] },
    emotion: { type: "string", enum: EMOTIONS },
  },
} as const;

// one-time persona + rules + dual-channel explanation (sent once per thread, afterwards relies on thread memory)
function introText(personaKey: string, bigBlind: number): string {
  const persona = PERSONAS[personaKey] ?? PERSONAS.professor;
  return `${persona.style}

You are playing no-limit Texas Hold'em (blinds ${bigBlind / 2}/${bigBlind}) 6-handed against other AIs and human players. We will play MANY hands in ONE long session — you remember every hand, your own past reasoning, and the reads you build on each opponent. Use that memory: track who bluffs, who only bets the nuts, who folds to pressure, and adapt over time.

Do not use any tools or run any commands — reason internally and answer.

## Two channels — use them like a real player
- PRIVATE: "monologue" is your true inner thinking. Nobody at the table sees it. Be honest — real reads, real plans, real fear. You DO remember your own past monologues.
- PUBLIC: "say" and "emotion" are a PERFORMANCE the whole table sees. You may lie, slow-roll, fake confidence with trash or act scared with the nuts. Deception is good poker. Opponents' past table talk and shown emotions appear in the log — they may be acting too.

Each turn I give you the situation; respond with ONE object matching the schema, nothing else.`;
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

Respond with your decision object now.`;
}

export async function codexDecide(ctx: DecisionContext): Promise<Decision | null> {
  const entry = getThread(ctx.seat, ctx.modelId, ctx.reasoningEffort);
  const prompt = entry.introduced
    ? situationText(ctx)
    : `${introText(ctx.personaKey, ctx.bigBlind)}\n\n${situationText(ctx)}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TABLE.aiTimeoutMs);
  try {
    const turn = await entry.thread.run(prompt, {
      outputSchema: DECISION_SCHEMA,
      signal: ac.signal,
    });
    entry.introduced = true;
    tallyCodex(turn.usage);
    return parseDecision(turn.finalResponse ?? "", ctx);
  } catch (e) {
    // error/timeout: discard this thread and rebuild next time. Better to lose one seat's memory than to stall the rest of the game
    seatThreads.delete(ctx.seat);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function codexShowMuck(ctx: ShowMuckContext): Promise<ShowMuckDecision | null> {
  const entry = getThread(ctx.seat, ctx.modelId, ctx.reasoningEffort);
  const prompt = `## Hand #${ctx.handNumber} — you won ${ctx.amount} UNCONTESTED (everyone folded to you).
Your hole cards: ${ctx.holeCards.map(cardText).join(" ")}
Board: ${ctx.board.length ? ctx.board.map(cardText).join(" ") : "(preflop, no board)"}
Action this hand:
${ctx.handHistory}

Decide in character: SHOW your cards (rub in a bluff / build credibility for future bluffs, but give opponents free info) or MUCK (keep them guessing). Respond with the show/muck object.`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const turn = await entry.thread.run(prompt, {
      outputSchema: SHOWMUCK_SCHEMA,
      signal: ac.signal,
    });
    entry.introduced = true;
    tallyCodex(turn.usage);
    return parseShowMuck(turn.finalResponse ?? "");
  } catch (e) {
    seatThreads.delete(ctx.seat);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
