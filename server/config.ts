import * as fs from "node:fs";
import * as path from "node:path";
import type { SeatConfig } from "./types.js";

// lightweight .env loader (no deps): just put CURSOR_API_KEY in the project root .env
try {
  const envFile = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of envFile.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env, fall back to process env vars
}

// ===== change models only here =====
// cross-vendor showdown: GPT goes through the Codex SDK, Opus through the Anthropic SDK, auto-routed by modelId.
// modelId containing opus/claude/sonnet/haiku → Anthropic; otherwise → OpenAI/Codex.
// all reasoningEffort: "low" (fast, stable, cheap). To swap models just change modelId.
export const AI_SEATS: SeatConfig[] = [
  { name: "The Professor", kind: "ai", modelId: "gpt-5.5", reasoningEffort: "low", persona: "professor", color: "#5b8def", avatar: "professor" },
  { name: "Mad Max", kind: "ai", modelId: "claude-opus-4-8", reasoningEffort: "low", persona: "maniac", color: "#ef5b5b", avatar: "maniac" },
  { name: "The Rock", kind: "ai", modelId: "gpt-5.4", reasoningEffort: "low", persona: "rock", color: "#8a9b6e", avatar: "rock" },
  { name: "Luna", kind: "ai", modelId: "claude-opus-4-7", reasoningEffort: "low", persona: "luna", color: "#c45bef", avatar: "luna" },
];

export const TABLE = {
  numSeats: 6, // 4 AI + 2 humans
  buyIn: 2000,
  smallBlind: 10,
  bigBlind: 20,
  humanTimeoutMs: 60_000, // human action countdown (auto check/fold on timeout)
  aiTimeoutMs: 30_000, // AI decision timeout → rule fallback
  aiMinThinkMs: 2500, // demo pacing: AI "thinks" at least this long
  interTurnDelayMs: 2200, // pause between each action, gives the audience time to digest
  interHandDelayMs: 11000, // settlement display hold (let everyone see who won/lost before the next hand)
  port: 3001,
};

// per-vendor availability (based on whether the key exists); seats route to their driver by modelId, seats missing a key use the rule fallback
export const OPENAI_ENABLED = !!process.env.OPENAI_API_KEY;
export const ANTHROPIC_ENABLED = !!process.env.ANTHROPIC_API_KEY;
// overall summary for the startup log
export const AI_DRIVER: "model" | "rule" = OPENAI_ENABLED || ANTHROPIC_ENABLED ? "model" : "rule";
