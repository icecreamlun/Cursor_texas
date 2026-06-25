// shared types: server-side state machine + snapshots pushed to the frontend

export type Card = { rank: string; suit: "spades" | "hearts" | "diamonds" | "clubs" };

export type Emotion =
  | "neutral"
  | "thinking"
  | "confident"
  | "nervous"
  | "happy"
  | "tilted"
  | "pokerface"
  | "shocked";

export type ActionKind = "fold" | "check" | "call" | "raise" | "allin";

export interface Decision {
  action: ActionKind;
  amount?: number; // raise target amount (total chips bet)
  monologue: string; // inner monologue (visible to big-screen audience)
  say?: string; // table trash talk
  emotion: Emotion;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface SeatConfig {
  name: string;
  kind: "ai" | "human";
  modelId?: string; // ai only: model id (Codex: gpt-5.5 etc; Cursor: composer etc)
  reasoningEffort?: ReasoningEffort; // ai only: Codex reasoning tier, the key differentiating dimension of the benchmark
  persona?: string; // key in personas.ts
  color: string; // avatar theme color
  avatar?: string; // avatar style key
}

export interface PlayerPublic {
  seat: number;
  name: string;
  kind: "ai" | "human";
  modelId?: string;
  color: string;
  avatar: string;
  stack: number;
  betThisRound: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  isDealer: boolean;
  isTurn: boolean;
  emotion: Emotion;
  lastAction?: { kind: ActionKind; amount?: number };
  isHero: boolean;
  connected: boolean;
}

export interface MonologueEntry {
  id: number;
  seat: number;
  name: string;
  color: string;
  avatar: string;
  modelId?: string;
  monologue: string;
  say?: string;
  emotion: Emotion;
  action: ActionKind | "show" | "muck";
  amount?: number;
  street: string;
  ts: number;
  cards?: Card[]; // that player's hole cards at the time — only visible in the god-view sidebar
}

// settlement of one hand: how much each participant won/lost
export interface HandResultLine {
  seat: number;
  name: string;
  color: string;
  avatar: string;
  modelId?: string;
  delta: number; // net win/loss this hand
  handName?: string; // hand type at showdown
  folded: boolean;
}

export interface HandResult {
  handNumber: number;
  reason: "showdown" | "folds"; // decided by showdown / everyone folded
  lines: HandResultLine[];
}

// show/muck choice after winning uncontested (no callers)
export interface ShowMuckDecision {
  show: boolean;
  monologue: string;
  say?: string;
  emotion: Emotion;
}

export interface LeaderboardRow {
  name: string;
  modelId?: string;
  color: string;
  avatar: string;
  stack: number;
  profit: number; // relative to buy-in
  handsWon: number;
  bluffsWon: number; // won without showdown and raised this hand
}

export interface TableSnapshot {
  started: boolean; // not yet started = lobby state, waiting for START or QR scan
  paused: boolean; // paused after this hand ends
  handNumber: number;
  street: "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";
  board: Card[];
  pot: number;
  toCall: number;
  minRaise: number;
  bigBlind: number;
  players: PlayerPublic[];
  heroSeat: number | null;
  heroCards: Card[] | null; // big-screen first-person view: hero hole cards revealed
  actingSeat: number | null;
  actingDeadline: number | null; // epoch ms, human countdown
  monologues: MonologueEntry[];
  leaderboard: LeaderboardRow[];
  joinUrl: string;
  banner: string | null; // big-event banner: "🔥 Maniac's bluff got caught!"
  showdown: { seat: number; cards: Card[]; handName?: string }[] | null;
  lastResult: HandResult | null; // settlement of the most recent hand (shown after showdown until the next hand is dealt)
}

// phone-side private view
export interface PrivateView {
  seat: number;
  name: string;
  cards: Card[] | null;
  stack: number;
  isTurn: boolean;
  toCall: number;
  minRaise: number;
  maxRaise: number;
  legal: ActionKind[];
  deadline: number | null;
  pot: number;
}
