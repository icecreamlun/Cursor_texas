import Poker from "poker-ts";
import type { ActionKind, Card } from "../types.js";

export type PokerAction = "fold" | "check" | "call" | "bet" | "raise";

export interface LegalView {
  actions: ActionKind[];
  toCall: number;
  minRaise: number;
  maxRaise: number;
}

// Wrapper around poker-ts Table: hides the bet/raise distinction, clamps amounts, reads state
export class PokerTable {
  table: InstanceType<typeof Poker.Table>;

  constructor(smallBlind: number, bigBlind: number, numSeats: number) {
    this.table = new Poker.Table({ smallBlind, bigBlind }, numSeats);
  }

  sitDown(seat: number, buyIn: number) {
    this.table.sitDown(seat, buyIn);
  }

  standUp(seat: number) {
    this.table.standUp(seat);
  }

  seats(): ({ totalChips: number; stack: number; betSize: number } | null)[] {
    return this.table.seats();
  }

  occupiedSeatCount(): number {
    return this.seats().filter(Boolean).length;
  }

  startHand() {
    this.table.startHand();
  }

  handInProgress() {
    return this.table.isHandInProgress();
  }

  bettingRoundInProgress() {
    return this.table.isHandInProgress() && this.table.isBettingRoundInProgress();
  }

  playerToAct(): number {
    return this.table.playerToAct();
  }

  button(): number {
    return this.table.button();
  }

  street(): "preflop" | "flop" | "turn" | "river" {
    return this.table.roundOfBetting();
  }

  board(): Card[] {
    return this.table.communityCards();
  }

  holeCards(seat: number): Card[] | null {
    const all = this.table.holeCards();
    return all[seat] ?? null;
  }

  inHand(seat: number): boolean {
    if (!this.table.isHandInProgress()) return false;
    return this.table.handPlayers()[seat] != null;
  }

  totalPot(): number {
    if (!this.table.isHandInProgress()) return 0;
    const pots = this.table.pots().reduce((s: number, p: any) => s + p.size, 0);
    // Add bets from the current round not yet collected into the pot (use seats() not handPlayers():
    // during an all-in runout handPlayers gets cleared, making the pot show as 0)
    const bets = this.table
      .seats()
      .reduce((s: number, p: any) => s + (p ? p.betSize : 0), 0);
    return pots + bets;
  }

  // Legal-action view for the current actor (normalized to ActionKind)
  legalView(): LegalView {
    const seat = this.playerToAct();
    const me = this.table.seats()[seat]!;
    const { actions, chipRange } = this.table.legalActions();
    const maxBet = Math.max(
      ...this.table.handPlayers().map((p: any) => (p ? p.betSize : 0))
    );
    const toCall = Math.max(0, maxBet - me.betSize);
    const kinds: ActionKind[] = [];
    if (actions.includes("fold")) kinds.push("fold");
    if (actions.includes("check")) kinds.push("check");
    if (actions.includes("call")) kinds.push("call");
    if (actions.includes("bet") || actions.includes("raise")) {
      kinds.push("raise", "allin");
    }
    return {
      actions: kinds,
      toCall,
      minRaise: chipRange?.min ?? 0,
      maxRaise: chipRange?.max ?? 0,
    };
  }

  // Unified action entry point: clamps illegal amounts, never lets the engine throw
  act(kind: ActionKind, amount?: number): { kind: ActionKind; amount?: number } {
    const { actions, chipRange } = this.table.legalActions();
    const raiseWord: PokerAction | null = actions.includes("raise")
      ? "raise"
      : actions.includes("bet")
        ? "bet"
        : null;

    const clamp = (n: number) =>
      Math.min(Math.max(n, chipRange?.min ?? n), chipRange?.max ?? n);

    if (kind === "allin" && raiseWord) {
      const size = chipRange!.max;
      this.table.actionTaken(raiseWord, size);
      return { kind: "allin", amount: size };
    }
    if ((kind === "raise" || kind === "allin") && raiseWord) {
      const size = clamp(amount ?? chipRange!.min);
      this.table.actionTaken(raiseWord, size);
      return size === chipRange!.max
        ? { kind: "allin", amount: size }
        : { kind: "raise", amount: size };
    }
    if (kind === "call" && actions.includes("call")) {
      this.table.actionTaken("call");
      return { kind: "call" };
    }
    if (kind === "check" && actions.includes("check")) {
      this.table.actionTaken("check");
      return { kind: "check" };
    }
    if (actions.includes("check")) {
      this.table.actionTaken("check");
      return { kind: "check" };
    }
    this.table.actionTaken("fold");
    return { kind: "fold" };
  }

  endBettingRound() {
    this.table.endBettingRound();
  }

  bettingRoundsCompleted() {
    return this.table.areBettingRoundsCompleted();
  }

  // Returns: [{seat, size}] each pot and its sole winner (won at showdown or by folds)
  finishHand(): {
    winnersBySeat: Map<number, number>; // seat -> amount won
    showdown: boolean;
    reveal: { seat: number; cards: Card[]; handName?: string }[];
  } {
    const winnersBySeat = new Map<number, number>();
    const reveal: { seat: number; cards: Card[]; handName?: string }[] = [];

    const pots = this.table.pots();
    const showdown = this.table.areBettingRoundsCompleted();
    if (process.env.POKER_DEBUG) {
      console.log("[debug] pots:", JSON.stringify(pots), "completed:", showdown,
        "handPlayers:", JSON.stringify(this.table.handPlayers()));
    }

    if (showdown) {
      this.table.showdown();
      const results = this.table.winners();
      if (process.env.POKER_DEBUG) console.log("[debug] winners:", JSON.stringify(results).slice(0, 400));
      if (results.length > 0) {
        results.forEach((potWinners: any[], i: number) => {
          const potSize = pots[i]?.size ?? 0;
          const share = Math.floor(potSize / potWinners.length);
          for (const [seat, hand, holeCards] of potWinners) {
            winnersBySeat.set(seat, (winnersBySeat.get(seat) ?? 0) + share);
            if (!reveal.some((r) => r.seat === seat)) {
              reveal.push({ seat, cards: holeCards, handName: HAND_NAMES[hand.ranking] });
            }
          }
        });
      } else {
        // Everyone else folded before showdown: the sole eligible player wins
        for (const pot of pots) {
          if (pot.eligiblePlayers.length === 1) {
            const seat = pot.eligiblePlayers[0];
            winnersBySeat.set(seat, (winnersBySeat.get(seat) ?? 0) + pot.size);
          }
        }
      }
    } else {
      // Everyone folded, no showdown
      for (const pot of pots) {
        if (pot.eligiblePlayers.length === 1) {
          const seat = pot.eligiblePlayers[0];
          winnersBySeat.set(seat, (winnersBySeat.get(seat) ?? 0) + pot.size);
        }
      }
      // Wrap up the hand: poker-ts auto-sets isHandInProgress to false when only one player remains
    }
    return { winnersBySeat, showdown, reveal };
  }
}

const HAND_NAMES: Record<number, string> = {
  0: "High Card",
  1: "Pair",
  2: "Two Pair",
  3: "Three of a Kind",
  4: "Straight",
  5: "Flush",
  6: "Full House",
  7: "Four of a Kind",
  8: "Straight Flush",
  9: "Royal Flush",
};

export function cardText(c: Card): string {
  const suits: Record<string, string> = {
    spades: "♠",
    hearts: "♥",
    diamonds: "♦",
    clubs: "♣",
  };
  return `${c.rank}${suits[c.suit]}`;
}
