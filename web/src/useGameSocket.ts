import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ActionKind, PrivateView, TableSnapshot } from "../../server/types";

function sessionId(): string {
  let id = localStorage.getItem("pb-session");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("pb-session", id);
  }
  return id;
}

export function useGameSocket(mode: "screen" | "play") {
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [priv, setPriv] = useState<PrivateView | null>(null);
  const [connected, setConnected] = useState(false);

  const socket: Socket = useMemo(
    () => io({ auth: { sessionId: sessionId() }, transports: ["websocket", "polling"] }),
    []
  );

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("watch");
      if (mode === "play") socket.emit("reconnectSeat");
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("snapshot", setSnapshot);
    let wasTurn = false;
    socket.on("private", (v: PrivateView) => {
      setPriv(v);
      if (v.isTurn && !wasTurn && navigator.vibrate) navigator.vibrate([120, 60, 120]);
      wasTurn = v.isTurn;
    });
    // Under StrictMode the effect cleans up (disconnect) then reruns, so reconnect manually here
    if (!socket.connected) socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket, mode]);

  return {
    snapshot,
    priv,
    connected,
    join: (name: string) =>
      new Promise<{ ok: boolean; error?: string }>((resolve) => {
        // On a server hot-restart the ack may be lost: a 5s timeout lets the user retry
        const timer = setTimeout(
          () => resolve({ ok: false, error: "No response — tap to retry" }),
          5000
        );
        socket.emit("join", name, (res: { ok: boolean; error?: string }) => {
          clearTimeout(timer);
          resolve(res);
        });
      }),
    act: (kind: ActionKind, amount?: number) => socket.emit("act", { kind, amount }),
    control: (cmd: "start" | "pause" | "resume" | "restart") => socket.emit("control", cmd),
  };
}
