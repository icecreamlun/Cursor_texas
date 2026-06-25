import type { Card as CardT } from "../../../server/types";

const SUITS: Record<string, { sym: string; color: string }> = {
  spades: { sym: "♠", color: "#2a2e3a" },
  clubs: { sym: "♣", color: "#2a2e3a" },
  hearts: { sym: "♥", color: "#d8434e" },
  diamonds: { sym: "♦", color: "#d8434e" },
};

const RANK_DISPLAY: Record<string, string> = { T: "10" };

export function PlayingCard({ card, size = "md", flip = false }: { card: CardT; size?: "sm" | "md" | "lg" | "xl"; flip?: boolean }) {
  const s = SUITS[card.suit];
  return (
    <div className={`pcard pcard-${size} ${flip ? "pcard-flip" : ""}`} style={{ color: s.color }}>
      <span className="pcard-rank">{RANK_DISPLAY[card.rank] ?? card.rank}</span>
      <span className="pcard-suit">{s.sym}</span>
    </div>
  );
}

export function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) {
  return <div className={`pcard pcard-${size} pcard-back`} />;
}
