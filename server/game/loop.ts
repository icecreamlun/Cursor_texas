import { PokerTable, cardText } from "./table.js";
import { AI_SEATS, TABLE } from "../config.js";
import { decide, decideShowMuck, resetAIMemory, type DecisionContext } from "../ai/driver.js";
import { PERSONAS } from "../ai/personas.js";
import type {
  ActionKind, Card, Decision, Emotion, HandResult, LeaderboardRow,
  MonologueEntry, PlayerPublic, PrivateView, TableSnapshot,
} from "../types.js";

interface SeatState {
  seat: number;
  name: string;
  kind: "ai" | "human";
  personaKey?: string;
  modelId?: string;
  reasoningEffort?: import("../types.js").ReasoningEffort;
  color: string;
  avatar: string;
  emotion: Emotion;
  lastAction?: { kind: ActionKind; amount?: number };
  connected: boolean;
  disconnectedAt?: number;
  buyInTotal: number;
  handsWon: number;
  bluffsWon: number;
  raisedThisHand: boolean;
  sessionId?: string; // human: socket session
}

const HUMAN_COLORS = ["#efb95b", "#5bdfc8"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GameRoom {
  table = new PokerTable(TABLE.smallBlind, TABLE.bigBlind, TABLE.numSeats);
  seats: (SeatState | null)[] = new Array(TABLE.numSeats).fill(null);
  handNumber = 0;
  street: TableSnapshot["street"] = "waiting";
  monologues: MonologueEntry[] = [];
  monologueId = 0;
  banner: string | null = null;
  actingSeat: number | null = null;
  actingDeadline: number | null = null;
  showdownReveal: TableSnapshot["showdown"] = null;
  handHistory: string[] = []; // action text for the current hand
  recentResults: string[] = []; // summary of the last few hands' results
  // poker-ts clears handPlayers after an all-in runout, so we track participants/folds/hole cards ourselves
  private participants: number[] = [];
  private foldedSeats = new Set<number>();
  private handCards = new Map<number, Card[]>();
  private stacksAtHandStart = new Map<number, number>(); // used to settle each hand's net win/loss
  lastResult: HandResult | null = null;
  private lastPot = 0; // final pot of the previous hand (kept on the big screen after the hand ends)
  joinUrl = "";
  // Flow control: defaults to lobby state, waiting for someone to scan in or the host to hit START
  started = false;
  paused = false;
  private restartRequested = false;
  private pendingJoins: { name: string; sessionId: string }[] = [];
  private humanWaiter: {
    seat: number;
    resolve: (d: { kind: ActionKind; amount?: number } | null) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  onSnapshot: (snap: TableSnapshot) => void = () => {};
  onPrivate: (sessionId: string, view: PrivateView) => void = () => {};

  constructor() {
    AI_SEATS.forEach((cfg, i) => {
      this.seats[i] = {
        seat: i, name: cfg.name, kind: "ai", personaKey: cfg.persona,
        modelId: cfg.modelId, reasoningEffort: cfg.reasoningEffort,
        color: cfg.color, avatar: cfg.avatar ?? cfg.persona ?? "professor",
        emotion: "neutral", connected: true, buyInTotal: TABLE.buyIn,
        handsWon: 0, bluffsWon: 0, raisedThisHand: false,
      };
      this.table.sitDown(i, TABLE.buyIn);
    });
  }

  // ===== Human join (takes effect next hand) =====
  join(name: string, sessionId: string): { ok: boolean; seat?: number; error?: string } {
    const existing = this.seats.findIndex((s) => s?.sessionId === sessionId);
    if (existing >= 0) return { ok: true, seat: existing };
    const free = this.seats.findIndex((s) => s === null);
    if (free < 0 && !this.pendingJoins.length) return { ok: false, error: "Table is full — catch the next one!" };
    this.pendingJoins.push({ name: name.slice(0, 12) || "Mystery Guest", sessionId });
    // Someone scanned in and took a seat → auto-start the game
    if (!this.started) {
      this.started = true;
      this.pushBanner(`🎬 ${this.pendingJoins[this.pendingJoins.length - 1].name} sat down — dealing!`);
    }
    this.broadcast();
    return { ok: true };
  }

  // ===== Host controls (big-screen buttons) =====
  control(cmd: "start" | "pause" | "resume" | "restart") {
    switch (cmd) {
      case "start":
        if (!this.started) {
          this.started = true;
          this.pushBanner("🎬 Game on — shuffling up and dealing!");
        }
        this.paused = false;
        break;
      case "pause":
        this.paused = true;
        this.pushBanner("⏸ Pausing after this hand");
        break;
      case "resume":
        this.paused = false;
        this.pushBanner("▶ Back to the felt!");
        break;
      case "restart":
        this.restartRequested = true;
        this.pushBanner("🔄 Restarting after this hand — fresh stacks for everyone");
        break;
    }
    this.broadcast();
  }

  // Full reset: zero out chips, stats, and monologues; humans keep their seats, AIs rebuy
  private doRestart() {
    this.restartRequested = false;
    resetAIMemory(); // clear each AI's persistent thread; the new game starts with zero memory
    this.seats.forEach((s, i) => {
      if (!s) return;
      if (this.table.seats()[i]) this.table.standUp(i);
      this.table.sitDown(i, TABLE.buyIn);
      s.buyInTotal = TABLE.buyIn;
      s.handsWon = 0;
      s.bluffsWon = 0;
      s.raisedThisHand = false;
      s.emotion = "neutral";
      s.lastAction = undefined;
    });
    this.handNumber = 0;
    this.monologues = [];
    this.recentResults = [];
    this.handHistory = [];
    this.showdownReveal = null;
    this.lastResult = null;
    this.banner = null;
    this.street = "waiting";
    this.started = false;
    this.paused = false;
    this.broadcast();
  }

  setConnected(sessionId: string, connected: boolean) {
    const s = this.seats.find((s) => s?.sessionId === sessionId);
    if (s) {
      s.connected = connected;
      s.disconnectedAt = connected ? undefined : Date.now();
      this.broadcast();
    }
  }

  // Release the seat of any human disconnected for over 60s (scan-in spectators come and go)
  private evictStaleHumans() {
    this.seats.forEach((s, i) => {
      if (s?.kind === "human" && !s.connected && s.disconnectedAt && Date.now() - s.disconnectedAt > 60_000) {
        if (this.table.seats()[i]) this.table.standUp(i);
        this.seats[i] = null;
        this.pushBanner(`👋 ${s.name} left the table`);
      }
    });
  }

  humanAct(sessionId: string, kind: ActionKind, amount?: number) {
    const seat = this.seats.findIndex((s) => s?.sessionId === sessionId);
    if (seat < 0 || !this.humanWaiter || this.humanWaiter.seat !== seat) return;
    const w = this.humanWaiter;
    this.humanWaiter = null;
    clearTimeout(w.timer);
    w.resolve({ kind, amount });
  }

  private applyPendingJoins() {
    while (this.pendingJoins.length) {
      const free = this.seats.findIndex((s) => s === null);
      if (free < 0) break;
      const j = this.pendingJoins.shift()!;
      this.seats[free] = {
        seat: free, name: j.name, kind: "human", color: HUMAN_COLORS[free % HUMAN_COLORS.length],
        avatar: "human", emotion: "neutral", connected: true, buyInTotal: TABLE.buyIn,
        handsWon: 0, bluffsWon: 0, raisedThisHand: false, sessionId: j.sessionId,
      };
      this.table.sitDown(free, TABLE.buyIn);
      this.pushBanner(`🎉 ${j.name} joined the table!`);
    }
  }

  private rebuyBusted() {
    this.table.seats().forEach((s, i) => {
      if (!this.seats[i]) return;
      // Busted players get auto-removed from their seat by poker-ts (s === null), or their totalChips hits zero
      if (s === null || s.totalChips === 0) {
        if (s !== null) this.table.standUp(i);
        this.table.sitDown(i, TABLE.buyIn);
        this.seats[i]!.buyInTotal += TABLE.buyIn;
        this.pushBanner(`💸 ${this.seats[i]!.name} busted — rebuying for ${TABLE.buyIn}`);
      }
    });
  }

  // Whether still in the current hand (tracked ourselves, not relying on poker-ts's handPlayers)
  private seatInHand(seat: number): boolean {
    return this.participants.includes(seat) && !this.foldedSeats.has(seat);
  }

  // ===== Main loop =====
  async run() {
    for (;;) {
      if (this.restartRequested) this.doRestart();
      this.evictStaleHumans();
      this.applyPendingJoins();
      this.rebuyBusted();
      // Lobby/paused state: don't deal, wait for START, a scan-in, or RESUME
      if (!this.started || this.paused || this.table.occupiedSeatCount() < 2) {
        this.street = "waiting";
        this.broadcast();
        await sleep(1200);
        continue;
      }
      try {
        await this.playHand();
      } catch (e) {
        // Error mid-hand: log it and reset the whole table; the demo can't stop
        console.error("[game] hand crashed, resetting table:", e);
        this.pushBanner("🛠 Table hiccup — fresh shuffle!");
        try {
          this.doRestart();
          this.started = true; // auto-continue, don't go back to the lobby
        } catch (e2) {
          console.error("[game] reset failed:", e2);
        }
      }
      await sleep(TABLE.interHandDelayMs);
    }
  }

  private async playHand() {
    this.handNumber++;
    this.handHistory = [];
    this.showdownReveal = null;
    this.banner = null;
    this.seats.forEach((s) => {
      if (s) { s.lastAction = undefined; s.raisedThisHand = false; s.emotion = "neutral"; }
    });
    this.table.startHand();
    this.street = this.table.street();
    this.lastResult = null;
    // Record each player's starting chips, used to settle net win/loss (including posted blinds)
    this.stacksAtHandStart.clear();
    this.table.seats().forEach((s, i) => {
      if (s) this.stacksAtHandStart.set(i, s.totalChips);
    });
    // Record participants and hole cards at the start of the hand (poker-ts is unreliable after runout)
    this.foldedSeats.clear();
    this.handCards.clear();
    this.participants = this.seats
      .map((s, i) => (s && this.table.inHand(i) ? i : -1))
      .filter((i) => i >= 0);
    for (const i of this.participants) {
      const cards = this.table.holeCards(i);
      if (cards) this.handCards.set(i, cards);
    }
    this.broadcast();
    await sleep(1500);

    while (this.table.handInProgress()) {
      while (this.table.bettingRoundInProgress()) {
        await this.handleTurn();
      }
      this.table.endBettingRound();
      if (this.table.bettingRoundsCompleted()) {
        await this.finishHand();
      } else {
        this.street = this.table.street();
        this.actingSeat = null;
        this.broadcast();
        await sleep(1800); // pause on the new street to let viewers see the cards
      }
    }
  }

  private async handleTurn() {
    const seat = this.table.playerToAct();
    const st = this.seats[seat];
    if (!st) { this.table.act("fold"); return; }

    const legal = this.table.legalView();
    this.actingSeat = seat;
    this.street = this.table.street();

    let applied: { kind: ActionKind; amount?: number };
    let decision: Decision | null = null;

    if (st.kind === "ai") {
      st.emotion = "thinking";
      this.actingDeadline = null;
      this.broadcast();
      const ctx = this.buildContext(st, legal);
      const t0 = Date.now();
      decision = await decide(ctx);
      const elapsed = Date.now() - t0;
      if (elapsed < TABLE.aiMinThinkMs) await sleep(TABLE.aiMinThinkMs - elapsed);
      applied = this.table.act(decision.action, decision.amount);
      st.emotion = decision.emotion;
    } else {
      // Disconnected players auto-act quickly so they don't drag down the table's pace
      const timeoutMs = st.connected ? TABLE.humanTimeoutMs : 4000;
      this.actingDeadline = Date.now() + timeoutMs;
      this.broadcast();
      this.sendPrivate(st, legal);
      const human = await this.waitForHuman(seat, timeoutMs);
      applied = human
        ? this.table.act(human.kind, human.amount)
        : this.table.act(legal.actions.includes("check") ? "check" : "fold");
      if (!human) this.pushBanner(`⏰ ${st.name} timed out — auto ${applied.kind === "check" ? "check" : "fold"}`);
      st.emotion = "neutral";
    }

    st.lastAction = applied;
    if (applied.kind === "fold") this.foldedSeats.add(seat);
    if (applied.kind === "raise" || applied.kind === "allin") st.raisedThisHand = true;

    const actText = this.actionText(applied);
    // All public info goes into the log: action + the emotion performed + trash talk (monologue never enters, stays private)
    const shown = decision
      ? `, shows ${decision.emotion}${decision.say ? `, says "${decision.say}"` : ""}`
      : "";
    this.handHistory.push(`${st.name} (${st.kind === "ai" ? st.modelId : "human"}) ${actText}${shown} [${this.street}]`);

    if (decision) {
      this.monologues.push({
        id: ++this.monologueId, seat, name: st.name, color: st.color, avatar: st.avatar,
        modelId: st.modelId, monologue: decision.monologue, say: decision.say,
        emotion: decision.emotion, action: applied.kind, amount: applied.amount,
        street: this.street, ts: Date.now(),
        cards: this.handCards.get(seat), // visible only in god view
      });
      if (this.monologues.length > 60) this.monologues.splice(0, this.monologues.length - 60);
    }

    this.actingSeat = null;
    this.actingDeadline = null;
    this.broadcast();
    await sleep(TABLE.interTurnDelayMs);
  }

  private waitForHuman(seat: number, timeoutMs: number): Promise<{ kind: ActionKind; amount?: number } | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.humanWaiter = null;
        resolve(null);
      }, timeoutMs);
      this.humanWaiter = { seat, resolve, timer };
    });
  }

  private async finishHand() {
    const inHandSeats = this.participants.filter((i) => !this.foldedSeats.has(i));
    const potBefore = this.table.totalPot();
    this.lastPot = potBefore;
    const cardsBySeat = this.handCards;

    const { winnersBySeat, reveal } = this.table.finishHand();
    const realShowdown = inHandSeats.length > 1 && reveal.length > 0;

    this.street = "showdown";
    if (realShowdown) {
      this.showdownReveal = inHandSeats.map((i) => ({
        seat: i,
        cards: cardsBySeat.get(i) ?? [],
        handName: reveal.find((r) => r.seat === i)?.handName,
      }));
    }

    const results: string[] = [];
    for (const [seat, amount] of winnersBySeat) {
      const st = this.seats[seat];
      if (!st) continue;
      st.handsWon++;
      st.emotion = "happy";
      const handName = reveal.find((r) => r.seat === seat)?.handName;
      if (realShowdown) {
        this.pushBanner(`🏆 ${st.name} wins ${amount} with ${handName ?? "the better hand"}!`);
        results.push(`Hand #${this.handNumber}: ${st.name} won ${amount} at showdown with ${handName ?? "a strong hand"}`);
      } else {
        // Won uncontested: no forced reveal — the AI decides whether to show (mind game) or muck (give no info)
        if (st.raisedThisHand) st.bluffsWon++;
        const cards = cardsBySeat.get(seat);
        let shown = false;
        if (st.kind === "ai" && cards) {
          const d = await decideShowMuck({
            seat,
            name: st.name,
            personaKey: st.personaKey ?? "professor",
            modelId: st.modelId,
            reasoningEffort: st.reasoningEffort,
            handNumber: this.handNumber,
            holeCards: cards,
            board: safeBoard(this.table),
            amount,
            handHistory: this.handHistory.join("\n"),
          });
          shown = d.show;
          st.emotion = d.emotion;
          this.monologues.push({
            id: ++this.monologueId, seat, name: st.name, color: st.color, avatar: st.avatar,
            modelId: st.modelId, monologue: d.monologue, say: d.say, emotion: d.emotion,
            action: d.show ? "show" : "muck", street: "showdown", ts: Date.now(),
            cards,
          });
        }
        if (shown && cards) {
          const cardsStr = cards.map(cardText).join(" ");
          this.showdownReveal = [...(this.showdownReveal ?? []), { seat, cards }];
          this.pushBanner(`😏 ${st.name} wins ${amount} and SHOWS: ${cardsStr}`);
          results.push(`Hand #${this.handNumber}: ${st.name} won ${amount} uncontested and chose to SHOW ${cardsStr}`);
        } else {
          this.pushBanner(`💰 ${st.name} takes ${amount} uncontested — cards into the muck`);
          results.push(`Hand #${this.handNumber}: ${st.name} won ${amount} uncontested, mucked without showing`);
        }
      }
    }
    // Big loser's emotion
    if (potBefore > TABLE.bigBlind * 10) {
      for (const i of inHandSeats) {
        if (!winnersBySeat.has(i) && this.seats[i]) this.seats[i]!.emotion = "tilted";
      }
    }
    this.recentResults.push(...results);
    if (this.recentResults.length > 6) this.recentResults.splice(0, this.recentResults.length - 6);

    // Per-hand settlement: compare against starting chips to compute each player's net win/loss (for the big-screen results panel)
    const seatInfoNow = this.table.seats();
    this.lastResult = {
      handNumber: this.handNumber,
      reason: realShowdown ? "showdown" : "folds",
      lines: this.participants
        .map((i) => {
          const st2 = this.seats[i];
          if (!st2) return null;
          const before = this.stacksAtHandStart.get(i) ?? 0;
          const after = seatInfoNow[i]?.totalChips ?? 0;
          return {
            seat: i,
            name: st2.name,
            color: st2.color,
            avatar: st2.avatar,
            modelId: st2.modelId,
            delta: after - before,
            handName: reveal.find((r) => r.seat === i)?.handName,
            folded: this.foldedSeats.has(i),
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null)
        .sort((a, b) => b.delta - a.delta),
    };

    this.actingSeat = null;
    this.broadcast();
  }

  // ===== AI prompt context =====
  private buildContext(st: SeatState, legal: ReturnType<PokerTable["legalView"]>): DecisionContext {
    const seatInfo = this.table.seats();
    const playersDesc = this.seats
      .filter((s): s is SeatState => !!s)
      .map((s) => {
        const info = seatInfo[s.seat];
        const status = !this.seatInHand(s.seat) ? "folded" : info ? `stack ${info.stack}` : "";
        return `${s.name} (${s.kind === "ai" ? "AI: " + s.modelId : "human player"}, ${status})`;
      })
      .join(", ");

    return {
      seat: st.seat,
      name: st.name,
      personaKey: st.personaKey ?? "professor",
      modelId: st.modelId,
      reasoningEffort: st.reasoningEffort,
      handNumber: this.handNumber,
      street: this.table.street(),
      holeCards: this.handCards.get(st.seat) ?? [],
      board: this.table.board(),
      pot: this.table.totalPot(),
      toCall: legal.toCall,
      minRaise: legal.minRaise,
      maxRaise: legal.maxRaise,
      myStack: seatInfo[st.seat]?.stack ?? 0,
      bigBlind: TABLE.bigBlind,
      legal: legal.actions,
      position: this.positionName(st.seat),
      playersDesc,
      handHistory: this.handHistory.join("\n"),
      recentHistory: this.recentResults.join("\n"),
    };
  }

  private positionName(seat: number): string {
    try {
      const btn = this.table.button();
      if (seat === btn) return "BTN (dealer)";
      const occupied = this.participants.filter((i) => this.seats[i]);
      const order = [...occupied.filter((i) => i > btn), ...occupied.filter((i) => i <= btn)].filter((i) => i !== btn);
      const idx = order.indexOf(seat);
      return ["SB (small blind)", "BB (big blind)", "UTG", "MP", "CO"][idx] ?? `seat ${idx}`;
    } catch {
      return "unknown";
    }
  }

  private actionText(a: { kind: ActionKind; amount?: number }): string {
    switch (a.kind) {
      case "fold": return "folds";
      case "check": return "checks";
      case "call": return "calls";
      case "raise": return `raises to ${a.amount}`;
      case "allin": return `goes ALL-IN ${a.amount}`;
    }
  }

  private pushBanner(text: string) {
    this.banner = text;
    this.broadcast();
  }

  // ===== Snapshot building and broadcasting =====
  buildSnapshot(): TableSnapshot {
    const seatInfo = this.table.seats();
    const handInProgress = this.table.handInProgress();
    const btn = handInProgress ? this.table.button() : -1;
    const heroSeat = this.seats.findIndex((s) => s?.kind === "human");

    const players: PlayerPublic[] = this.seats
      .filter((s): s is SeatState => !!s)
      .map((s) => {
        const info = seatInfo[s.seat];
        return {
          seat: s.seat, name: s.name, kind: s.kind, modelId: s.modelId,
          color: s.color, avatar: s.avatar,
          stack: info?.stack ?? 0,
          betThisRound: info?.betSize ?? 0,
          folded: handInProgress ? !this.seatInHand(s.seat) : false,
          allIn: handInProgress ? this.seatInHand(s.seat) && info?.stack === 0 : false,
          inHand: handInProgress ? this.seatInHand(s.seat) : false,
          isDealer: s.seat === btn,
          isTurn: s.seat === this.actingSeat,
          emotion: s.emotion,
          lastAction: s.lastAction,
          isHero: s.seat === heroSeat,
          connected: s.connected,
        };
      });

    let toCall = 0, minRaise = 0;
    if (this.table.bettingRoundInProgress()) {
      const lv = this.table.legalView();
      toCall = lv.toCall;
      minRaise = lv.minRaise;
    }

    return {
      started: this.started,
      paused: this.paused,
      handNumber: this.handNumber,
      street: this.street,
      board: handInProgress || this.street === "showdown" ? safeBoard(this.table) : [],
      pot: handInProgress ? this.table.totalPot() : this.lastPot,
      toCall, minRaise,
      bigBlind: TABLE.bigBlind,
      players,
      heroSeat: heroSeat >= 0 ? heroSeat : null,
      heroCards: heroSeat >= 0 ? (this.handCards.get(heroSeat) ?? null) : null,
      actingSeat: this.actingSeat,
      actingDeadline: this.actingDeadline,
      monologues: this.monologues.slice(-30),
      leaderboard: this.buildLeaderboard(),
      joinUrl: this.joinUrl,
      banner: this.banner,
      showdown: this.showdownReveal,
      lastResult: this.lastResult,
    };
  }

  private buildLeaderboard(): LeaderboardRow[] {
    const seatInfo = this.table.seats();
    return this.seats
      .filter((s): s is SeatState => !!s)
      .map((s) => ({
        name: s.name,
        modelId: s.modelId,
        color: s.color,
        avatar: s.avatar,
        stack: seatInfo[s.seat]?.totalChips ?? 0,
        profit: (seatInfo[s.seat]?.totalChips ?? 0) - s.buyInTotal + (s.buyInTotal - TABLE.buyIn),
        handsWon: s.handsWon,
        bluffsWon: s.bluffsWon,
      }))
      .sort((a, b) => b.profit - a.profit);
  }

  private sendPrivate(st: SeatState, legal: ReturnType<PokerTable["legalView"]>) {
    if (!st.sessionId) return;
    const seatInfo = this.table.seats();
    this.onPrivate(st.sessionId, {
      seat: st.seat,
      name: st.name,
      cards: this.handCards.get(st.seat) ?? null,
      stack: seatInfo[st.seat]?.stack ?? 0,
      isTurn: this.actingSeat === st.seat,
      toCall: legal.toCall,
      minRaise: legal.minRaise,
      maxRaise: legal.maxRaise,
      legal: legal.actions,
      deadline: this.actingDeadline,
      pot: this.table.totalPot(),
    });
  }

  // Push each human their own private view (hole cards, etc.)
  pushAllPrivate() {
    for (const s of this.seats) {
      if (!s || s.kind !== "human" || !s.sessionId) continue;
      const isTurn = this.actingSeat === s.seat;
      const lv = isTurn && this.table.bettingRoundInProgress()
        ? this.table.legalView()
        : { actions: [] as ActionKind[], toCall: 0, minRaise: 0, maxRaise: 0 };
      const seatInfo = this.table.seats();
      this.onPrivate(s.sessionId, {
        seat: s.seat,
        name: s.name,
        cards: this.seatInHand(s.seat) ? (this.handCards.get(s.seat) ?? null) : null,
        stack: seatInfo[s.seat]?.stack ?? 0,
        isTurn,
        toCall: lv.toCall,
        minRaise: lv.minRaise,
        maxRaise: lv.maxRaise,
        legal: lv.actions,
        deadline: isTurn ? this.actingDeadline : null,
        pot: this.table.totalPot(),
      });
    }
  }

  private broadcast() {
    this.onSnapshot(this.buildSnapshot());
    this.pushAllPrivate();
  }
}

function safeBoard(table: PokerTable): Card[] {
  try {
    return table.board();
  } catch {
    return [];
  }
}
