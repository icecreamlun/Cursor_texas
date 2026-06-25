import type { ActionKind, Card, Decision, ReasoningEffort, ShowMuckDecision } from "../types.js";
import { ruleDecide } from "./ruleDriver.js";
import { codexDecide, codexShowMuck, resetCodexMemory } from "./codexDriver.js";
import { anthropicDecide, anthropicShowMuck, resetAnthropicMemory } from "./anthropicDriver.js";
import { PERSONAS } from "./personas.js";
import { OPENAI_ENABLED, ANTHROPIC_ENABLED, TABLE } from "../config.js";

// route by modelId: opus/claude/sonnet/haiku → Anthropic; otherwise → OpenAI/Codex
function isAnthropicModel(modelId?: string): boolean {
  return /opus|claude|sonnet|haiku/i.test(modelId ?? "");
}
function deciderFor(modelId?: string) {
  if (isAnthropicModel(modelId)) return ANTHROPIC_ENABLED ? anthropicDecide : null;
  return OPENAI_ENABLED ? codexDecide : null;
}
function showMuckerFor(modelId?: string) {
  if (isAnthropicModel(modelId)) return ANTHROPIC_ENABLED ? anthropicShowMuck : null;
  return OPENAI_ENABLED ? codexShowMuck : null;
}

// clear AI memory when the whole table restarts (clears both drivers' persistent state, no side effect if one is absent)
export function resetAIMemory(): void {
  resetCodexMemory();
  resetAnthropicMemory();
}

// decision context: everything the AI (or rules) needs to know
export interface DecisionContext {
  seat: number;
  name: string;
  personaKey: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  handNumber: number;
  street: string;
  holeCards: Card[];
  board: Card[];
  pot: number;
  toCall: number;
  minRaise: number;
  maxRaise: number;
  myStack: number;
  bigBlind: number;
  legal: ActionKind[];
  position: string; // BTN/SB/BB/EP...
  // textualized situation info, fed directly into the prompt
  playersDesc: string; // each player's chips/status
  handHistory: string; // action sequence for this hand
  recentHistory: string; // summary of the last few hands' results
}

export async function decide(ctx: DecisionContext): Promise<Decision> {
  const modelDecide = deciderFor(ctx.modelId);
  if (!modelDecide) {
    return ruleDecide(ctx);
  }
  try {
    const result = await withTimeout(modelDecide(ctx), TABLE.aiTimeoutMs);
    if (result) return result;
  } catch (e) {
    console.error(`[ai] ${ctx.name} (${ctx.modelId}) decision failed, falling back to rules:`, (e as Error).message);
  }
  const fallback = ruleDecide(ctx);
  fallback.monologue = `(connection's spotty, going with my gut) ${fallback.monologue}`;
  return fallback;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  // key: after the race times out, if the losing promise rejects later,
  // it becomes an unhandled rejection that kills the whole process (Node's default behavior).
  // catch it up front here so a late failure is simply ignored.
  p.catch(() => {});
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// after winning uncontested: show or muck
export interface ShowMuckContext {
  seat: number;
  name: string;
  personaKey: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  handNumber: number;
  holeCards: Card[];
  board: Card[];
  amount: number;
  handHistory: string;
}

export async function decideShowMuck(ctx: ShowMuckContext): Promise<ShowMuckDecision> {
  const modelShowMuck = showMuckerFor(ctx.modelId);
  if (modelShowMuck) {
    try {
      const result = await withTimeout(modelShowMuck(ctx), 20_000);
      if (result) return result;
    } catch (e) {
      console.error(`[ai] ${ctx.name} show/muck failed, falling back to rules:`, (e as Error).message);
    }
  }
  // rule fallback: aggressive types occasionally show cards to needle opponents, tight types always muck
  const persona = PERSONAS[ctx.personaKey] ?? PERSONAS.professor;
  const show = persona.aggression > 0.7 && (ctx.handNumber + ctx.seat) % 3 === 0;
  return {
    show,
    monologue: show
      ? "Let them see it. A little tilt goes a long way."
      : "No free information. Into the muck they go.",
    emotion: show ? "confident" : "pokerface",
  };
}
