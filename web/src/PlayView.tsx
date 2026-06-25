import { useEffect, useState } from "react";
import { useGameSocket } from "./useGameSocket";
import { PlayingCard } from "./components/Card";

export default function PlayView() {
  const { snapshot, priv, connected, join, act } = useGameSocket("play");
  const [name, setName] = useState(localStorage.getItem("pb-name") ?? "");
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState("");
  const [raiseAmt, setRaiseAmt] = useState(0);

  const isTurn = !!priv?.isTurn && (priv?.legal.length ?? 0) > 0;

  useEffect(() => {
    if (priv && isTurn) setRaiseAmt(Math.min(priv.minRaise * 2 || priv.minRaise, priv.maxRaise));
  }, [isTurn]);

  // A seated session auto-restores after reconnecting
  useEffect(() => {
    if (priv) setJoined(true);
  }, [priv]);

  if (!joined) {
    return (
      <div className="play-root play-join">
        <div className="join-card">
          <div className="join-logo">🃏 POKER·BENCH</div>
          <div className="join-sub">Sit down and play Hold'em against 4 AIs</div>
          <input
            value={name}
            placeholder="Your name"
            maxLength={12}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!connected || !name.trim()}
            onClick={async () => {
              localStorage.setItem("pb-name", name.trim());
              const res = await join(name.trim());
              if (res.ok) setJoined(true);
              else setError(res.error ?? "Failed to join");
            }}
          >
            {connected ? "Take a seat 🚀" : "Connecting…"}
          </button>
          {error && <div className="join-error">{error}</div>}
          <div className="join-tip">You'll be dealt in from the next hand</div>
        </div>
      </div>
    );
  }

  const me = snapshot?.players.find((p) => p.seat === priv?.seat);

  return (
    <div className="play-root">
      <div className="play-top">
        <span className="play-name">🎮 {priv?.name ?? name}</span>
        <span className="play-stack">💰 {priv?.stack ?? "…"}</span>
        <span className="play-pot">POT {priv?.pot ?? snapshot?.pot ?? 0}</span>
      </div>

      <div className="play-cards">
        {priv?.cards ? (
          priv.cards.map((c) => <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="xl" flip />)
        ) : (
          <div className="play-waiting">
            {me ? (me.folded ? "You folded — next hand soon" : "Waiting for the deal…") : "You'll be seated next hand…"}
          </div>
        )}
      </div>

      {isTurn && priv ? (
        <div className="play-actions">
          <div className="turn-flag">Your turn! {priv.toCall > 0 ? `${priv.toCall} to call` : "You can check"}</div>
          <div className="btn-row">
            {priv.legal.includes("fold") && (
              <button className="btn btn-fold" onClick={() => act("fold")}>Fold</button>
            )}
            {priv.legal.includes("check") && (
              <button className="btn btn-check" onClick={() => act("check")}>Check</button>
            )}
            {priv.legal.includes("call") && (
              <button className="btn btn-call" onClick={() => act("call")}>Call {priv.toCall}</button>
            )}
          </div>
          {priv.legal.includes("raise") && priv.maxRaise > priv.minRaise && (
            <div className="raise-zone">
              <input
                type="range"
                min={priv.minRaise}
                max={priv.maxRaise}
                step={Math.max(10, Math.round(priv.minRaise / 10) * 5)}
                value={raiseAmt}
                onChange={(e) => setRaiseAmt(Number(e.target.value))}
              />
              <div className="btn-row">
                <button className="btn btn-raise" onClick={() => act("raise", raiseAmt)}>
                  Raise to {raiseAmt}
                </button>
                <button className="btn btn-allin" onClick={() => act("allin")}>
                  ALL-IN {priv.maxRaise}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="play-idle">
          {snapshot?.street === "showdown"
            ? "Showdown… eyes on the big screen!"
            : me && !me.folded
              ? "Waiting for other players…"
              : "Follow the action on the big screen 👀"}
        </div>
      )}
    </div>
  );
}
