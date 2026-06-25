import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useGameSocket } from "./useGameSocket";
import { Avatar } from "./components/Avatar";
import { PlayingCard, CardBack } from "./components/Card";
import type { ActionKind, MonologueEntry, PlayerPublic, TableSnapshot } from "../../server/types";

const STREET_LABEL: Record<string, string> = {
  waiting: "Lobby",
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

const ACTION_LABEL: Record<ActionKind | "show" | "muck", string> = {
  fold: "Fold",
  check: "Check",
  call: "Call",
  raise: "Raise",
  allin: "All in",
  show: "Show",
  muck: "Muck",
};

export default function TableView() {
  const { snapshot, control } = useGameSocket("screen");
  const [qr, setQr] = useState<{ dataUrl: string; url: string } | null>(null);

  useEffect(() => {
    fetch("/api/qr").then((r) => r.json()).then(setQr).catch(() => {});
  }, []);

  if (!snapshot) {
    return <div className="loading-screen">Connecting to the table...</div>;
  }

  return <Table snap={snapshot} qr={qr} control={control} />;
}

function Table({
  snap,
  qr,
  control,
}: {
  snap: TableSnapshot;
  qr: { dataUrl: string; url: string } | null;
  control: (cmd: "start" | "pause" | "resume" | "restart") => void;
}) {
  const hero = snap.players.find((p) => p.isHero);
  const opponents = snap.players.filter((p) => !p.isHero).slice(0, 5);
  const lastMono = snap.monologues[snap.monologues.length - 1];
  const boardSlots = Array.from({ length: 5 });
  const [godOpen, setGodOpen] = useState(false);
  const [qrZoom, setQrZoom] = useState(false);
  const showResult =
    snap.lastResult && (snap.street === "showdown" || snap.street === "waiting") && snap.started;

  return (
    <div className="cinema-room">
      <header className="cinema-header">
        <div className="event-pill">
          <span className="event-mark">♛</span>
          <span>POKER·BENCH</span>
        </div>

        <div className="join-cluster">
          <button className="join-pill" onClick={() => setQrZoom(true)} title="Click to enlarge">
            <span className="join-icon">♟</span>
            <span>{snap.players.filter((p) => p.kind === "human").length}</span>
            {qr && <img src={qr.dataUrl} alt="join the table" />}
          </button>
          <div className="join-copy">Scan to join · click to enlarge</div>
        </div>

        <div className="header-right">
          <div className="hand-pill">
            Hand {snap.handNumber} · {STREET_LABEL[snap.street]}
            {snap.paused && snap.street === "waiting" ? " · Paused" : ""}
          </div>
          {snap.started && (
            <>
              {snap.paused ? (
                <button className="ctrl-pill" onClick={() => control("resume")}>▶ Resume</button>
              ) : (
                <button className="ctrl-pill" onClick={() => control("pause")}>⏸ Pause</button>
              )}
              <button className="ctrl-pill" onClick={() => control("restart")}>↻ Restart</button>
            </>
          )}
          <button className={`god-toggle ${godOpen ? "god-toggle-on" : ""}`} onClick={() => setGodOpen(!godOpen)}>
            {godOpen ? "🧠 God view ON" : "🧠 Peek inside their heads"}
          </button>
        </div>
      </header>

      {snap.banner && <div className="banner-toast" key={snap.banner}>{snap.banner}</div>}

      <main className="poker-stage">
        <div className="table-glow" />
        <div className="table-rim" />
        <div className="table-core">
          <div className="board-wrap">
            <div className="pot-label">POT</div>
            <div className="pot-amount">${snap.pot}</div>
            <div className="blind-label">Blinds ${snap.bigBlind / 2} / ${snap.bigBlind}</div>
            <div className="board-cards">
              {boardSlots.map((_, i) =>
                snap.board[i] ? (
                  <PlayingCard key={`${snap.board[i].rank}${snap.board[i].suit}`} card={snap.board[i]} size="lg" flip />
                ) : (
                  <div className="pcard pcard-lg pcard-slot" key={`slot-${i}`} />
                )
              )}
            </div>
          </div>

          {opponents.map((p, i) => (
            <OpponentSpot
              key={p.seat}
              p={p}
              index={i}
              total={opponents.length}
              lastMono={lastMono}
              showdown={snap.showdown}
              isActing={snap.actingSeat === p.seat}
            />
          ))}

          <HeroSpot hero={hero} snap={snap} />

          {showResult && <ResultPanel snap={snap} />}

          {!snap.started && (
            <div className="lobby-overlay">
              <div className="lobby-title">The table is set</div>
              <div className="lobby-sub">Scan the QR code to sit down — or let the AIs battle.</div>
              <button className="start-btn" onClick={() => control("start")}>
                Start
              </button>
            </div>
          )}
        </div>

        <LeaderboardPanel snap={snap} />
        {!godOpen && <TalkPanel monologues={snap.monologues} />}
        <GodDrawer open={godOpen} monologues={snap.monologues} />

        {qrZoom && qr && (
          <div className="qr-modal" onClick={() => setQrZoom(false)}>
            <div className="qr-modal-card">
              <img src={qr.dataUrl} alt="join the table" />
              <div className="qr-modal-title">Scan to sit down</div>
              <div className="qr-modal-url">{qr.url}</div>
              <div className="qr-modal-hint">click anywhere to close</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ===== Opponent seat: self-contained vertical stack, no more floating cards =====
function OpponentSpot({
  p,
  index,
  total,
  lastMono,
  showdown,
  isActing,
}: {
  p: PlayerPublic;
  index: number;
  total: number;
  lastMono?: MonologueEntry;
  showdown: TableSnapshot["showdown"];
  isActing: boolean;
}) {
  const pos = seatPosition(index, total);
  const reveal = showdown?.find((s) => s.seat === p.seat);
  const saysNow = lastMono?.seat === p.seat && lastMono.say && !isActing;

  return (
    <section
      className={`seat-spot ${p.folded ? "seat-folded" : ""} ${isActing ? "seat-acting" : ""}`}
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="character-wrap">
        {isActing && (
          <div className="thinking-bubble">
            <span />
            <span />
            <span />
          </div>
        )}
        {saysNow && <div className="speech-pop">“{lastMono!.say}”</div>}
        <Avatar persona={p.avatar} emotion={p.emotion} color={p.color} size={132} />
      </div>

      <div className="mini-cards">
        {reveal && reveal.cards.length ? (
          <>
            {reveal.cards.map((c) => (
              <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="sm" flip />
            ))}
            {reveal.handName && <span className="hand-name-tag">{reveal.handName}</span>}
          </>
        ) : p.inHand ? (
          <>
            <CardBack size="sm" />
            <CardBack size="sm" />
          </>
        ) : null}
      </div>

      <div className="seat-plate" style={{ "--accent": p.color } as CSSProperties}>
        <div className="seat-plate-head">
          <strong>{p.name}</strong>
          {p.isDealer && <span className="dealer-chip">D</span>}
        </div>
        {p.modelId && <code className="model-tag">{p.modelId}</code>}
        <div className="seat-plate-row">
          <span className="seat-stack">${p.stack}</span>
          {p.lastAction && (
            <span className={`seat-action seat-action-${p.lastAction.kind}`}>
              {ACTION_LABEL[p.lastAction.kind]}
              {p.lastAction.amount ? ` $${p.lastAction.amount}` : ""}
            </span>
          )}
        </div>
      </div>

      {p.betThisRound > 0 && <div className="seat-bet">${p.betThisRound}</div>}
      {p.allIn && <div className="allin-flag">ALL IN</div>}
    </section>
  );
}

// Opponents arranged along the top arc of the table; count adapts
function seatPosition(index: number, total: number): { left: string; top: string } {
  const presets: Record<number, { left: string; top: string }[]> = {
    1: [{ left: "50%", top: "22%" }],
    2: [
      { left: "30%", top: "24%" },
      { left: "70%", top: "24%" },
    ],
    3: [
      { left: "20%", top: "36%" },
      { left: "50%", top: "19%" },
      { left: "80%", top: "36%" },
    ],
    4: [
      { left: "13%", top: "40%" },
      { left: "36%", top: "26%" },
      { left: "64%", top: "26%" },
      { left: "87%", top: "40%" },
    ],
    5: [
      { left: "12%", top: "48%" },
      { left: "29%", top: "24%" },
      { left: "50%", top: "17%" },
      { left: "71%", top: "24%" },
      { left: "88%", top: "48%" },
    ],
  };
  const arr = presets[Math.min(Math.max(total, 1), 5)];
  return arr[index] ?? arr[arr.length - 1];
}

function HeroSpot({ hero, snap }: { hero?: PlayerPublic; snap: TableSnapshot }) {
  return (
    <section className="hero-seat">
      {hero ? (
        <>
          <div className="hero-meta">
            <span className="hero-dot" style={{ background: hero.color }} />
            <strong>{hero.name} (you)</strong>
            <em>${hero.stack}</em>
            {hero.lastAction && (
              <span className={`seat-action seat-action-${hero.lastAction.kind}`}>
                {ACTION_LABEL[hero.lastAction.kind]}
                {hero.lastAction.amount ? ` $${hero.lastAction.amount}` : ""}
              </span>
            )}
          </div>
          <div className="hero-hand">
            {snap.heroCards ? (
              snap.heroCards.map((c) => <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="xl" flip />)
            ) : (
              <>
                <CardBack size="xl" />
                <CardBack size="xl" />
              </>
            )}
          </div>
        </>
      ) : (
        <div className="hero-empty">
          <div className="hero-empty-title">This seat is yours</div>
          <div className="hero-empty-sub">Scan the QR code to sit down</div>
        </div>
      )}
    </section>
  );
}

// ===== Per-hand settlement: who won how much, who lost how much =====
function ResultPanel({ snap }: { snap: TableSnapshot }) {
  const r = snap.lastResult!;
  return (
    <div className="result-panel">
      <div className="result-title">
        Hand {r.handNumber} · {r.reason === "showdown" ? "Showdown" : "Everyone folded"}
      </div>
      {snap.board.length > 0 && (
        <div className="result-board">
          {snap.board.map((c) => (
            <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="md" />
          ))}
        </div>
      )}
      {r.lines.map((l) => (
        <div className={`result-row ${l.delta > 0 ? "win" : l.delta < 0 ? "lose" : ""}`} key={l.seat}>
          <span className="result-dot" style={{ background: l.color }} />
          <span className="result-name">
            {l.name}
            {l.handName ? <em> · {l.handName}</em> : l.folded ? <em> · folded</em> : null}
          </span>
          <span className="result-delta">
            {l.delta > 0 ? `+$${l.delta}` : l.delta < 0 ? `−$${-l.delta}` : "$0"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ===== Cumulative leaderboard (replaces fake spectator count) =====
function LeaderboardPanel({ snap }: { snap: TableSnapshot }) {
  return (
    <aside className="leader-panel">
      <div className="panel-title">LEADERBOARD</div>
      {snap.leaderboard.map((row) => (
        <div className="leader-row" key={row.name}>
          <span className="result-dot" style={{ background: row.color }} />
          <div className="leader-main">
            <strong>{row.name}</strong>
            {row.modelId && <code className="model-tag">{row.modelId}</code>}
          </div>
          <span className={`leader-profit ${row.profit > 0 ? "win" : row.profit < 0 ? "lose" : ""}`}>
            {row.profit > 0 ? `+$${row.profit}` : row.profit < 0 ? `−$${-row.profit}` : "$0"}
          </span>
        </div>
      ))}
    </aside>
  );
}

// ===== Table talk (real say lines, never shows inner monologue) =====
function TalkPanel({ monologues }: { monologues: MonologueEntry[] }) {
  const rows = [...monologues].reverse().filter((m) => m.say).slice(0, 3);
  if (!rows.length) return null;

  return (
    <aside className="chat-panel">
      <div className="panel-title">TABLE TALK</div>
      {rows.map((row) => (
        <div className="chat-row" key={row.id}>
          <div className="chat-avatar" style={{ background: row.color }}>
            {row.name.slice(0, 1)}
          </div>
          <span>
            <b>{row.name}:</b> “{truncate(row.say!, 60)}”
          </span>
        </div>
      ))}
    </aside>
  );
}

// ===== God view drawer: inner monologue + real hole cards, only visible when opened =====
function GodDrawer({ open, monologues }: { open: boolean; monologues: MonologueEntry[] }) {
  if (!open) return null;
  const rows = [...monologues].reverse();

  return (
    <aside className="god-drawer">
      <div className="god-head">
        <span>🧠 INNER MONOLOGUE — what they'll never say out loud</span>
      </div>
      <div className="god-list">
        {rows.length === 0 && <div className="god-empty">Nothing yet — deal a hand first.</div>}
        {rows.map((m) => (
          <div className="god-item" key={m.id}>
            <div className="god-item-head">
              <span className="result-dot" style={{ background: m.color }} />
              <strong>{m.name}</strong>
              {m.modelId && <code className="model-tag">{m.modelId}</code>}
              <span className="god-street">{m.street}</span>
              <span className={`seat-action seat-action-${m.action}`}>
                {ACTION_LABEL[m.action]}
                {m.amount ? ` $${m.amount}` : ""}
              </span>
            </div>
            {m.cards && (
              <div className="god-cards">
                {m.cards.map((c) => (
                  <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="sm" />
                ))}
              </div>
            )}
            <p className="god-mono">{m.monologue}</p>
            {m.say && <p className="god-say">🗣 “{m.say}”</p>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
