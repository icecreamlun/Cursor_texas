import type { ActionKind, Decision, Emotion, ShowMuckDecision } from "../types.js";
import type { DecisionContext } from "./driver.js";

const ACTIONS: ActionKind[] = ["fold", "check", "call", "raise", "allin"];
const EMOTIONS: Emotion[] = [
  "neutral", "thinking", "confident", "nervous", "happy", "tilted", "pokerface", "shocked",
];

// Extract JSON from the model output and validate it; returns null on failure (driver falls back to rules)
export function parseDecision(text: string, ctx: DecisionContext): Decision | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: any;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }

  let action = String(raw.action ?? "").toLowerCase().replace(/[^a-z]/g, "") as ActionKind;
  if (action === ("all" as any) || action === ("allin" as any)) action = "allin";
  if (!ACTIONS.includes(action)) return null;

  // Fix illegal actions: can't check → fold / can't call → check
  if (!ctx.legal.includes(action)) {
    if (action === "check" && ctx.legal.includes("call")) action = "call";
    else if (action === "call" && ctx.legal.includes("check")) action = "check";
    else if ((action === "raise" || action === "allin") && ctx.legal.includes("call")) action = "call";
    else action = ctx.legal.includes("check") ? "check" : "fold";
  }

  let amount: number | undefined;
  if (action === "raise") {
    amount = Math.round(Number(raw.amount));
    if (!Number.isFinite(amount)) amount = ctx.minRaise;
    amount = Math.min(Math.max(amount, ctx.minRaise), ctx.maxRaise);
  }

  const emotion: Emotion = EMOTIONS.includes(raw.emotion) ? raw.emotion : "neutral";
  const full = String(raw.monologue ?? "");
  const monologue = (full.length > 400 ? full.slice(0, 400) + "…" : full) || "… (thinking in silence)";
  const say = raw.say ? String(raw.say).slice(0, 120) : undefined;

  return { action, amount, monologue, say, emotion };
}

export function parseShowMuck(text: string): ShowMuckDecision | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: any;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof raw.show !== "boolean") return null;
  const full = String(raw.monologue ?? "");
  return {
    show: raw.show,
    monologue: (full.length > 400 ? full.slice(0, 400) + "…" : full) || "… (saying nothing)",
    say: raw.say ? String(raw.say).slice(0, 120) : undefined,
    emotion: EMOTIONS.includes(raw.emotion) ? raw.emotion : "pokerface",
  };
}
