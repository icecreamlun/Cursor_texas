import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { GameRoom } from "./game/loop.js";
import { TABLE, AI_DRIVER, OPENAI_ENABLED, ANTHROPIC_ENABLED } from "./config.js";
import type { ActionKind } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// demo guard: just log any stray async errors, never let the process die
process.on("unhandledRejection", (e) => console.error("[guard] unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[guard] uncaught exception:", e));
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: "*" } });

// LAN IP, used for phone QR scanning (vite dev runs on 5173)
function lanIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}
const JOIN_URL = `http://${lanIp()}:5173/#/play`;

const room = new GameRoom();
room.joinUrl = JOIN_URL;

room.onSnapshot = (snap) => io.to("screen").emit("snapshot", snap);
room.onPrivate = (sessionId, view) => io.to(`session:${sessionId}`).emit("private", view);

io.on("connection", (socket) => {
  const sessionId = (socket.handshake.auth?.sessionId as string) || socket.id;
  socket.join(`session:${sessionId}`);

  socket.on("watch", () => {
    socket.join("screen");
    socket.emit("snapshot", room.buildSnapshot());
  });

  socket.on("join", (name: string, cb?: (res: any) => void) => {
    const res = room.join(String(name ?? ""), sessionId);
    socket.join("screen"); // phone also receives snapshots (sees the shared table)
    cb?.(res);
    room.pushAllPrivate();
  });

  socket.on("act", (data: { kind: ActionKind; amount?: number }) => {
    room.humanAct(sessionId, data?.kind, data?.amount);
  });

  // big-screen host controls
  socket.on("control", (cmd: "start" | "pause" | "resume" | "restart") => {
    if (["start", "pause", "resume", "restart"].includes(cmd)) room.control(cmd);
  });

  socket.on("disconnect", () => room.setConnected(sessionId, false));
  socket.on("reconnectSeat", () => room.setConnected(sessionId, true));
});

app.get("/api/qr", async (_req, res) => {
  const dataUrl = await QRCode.toDataURL(JOIN_URL, {
    margin: 1,
    width: 360,
    color: { dark: "#1a1d27", light: "#ffffff" },
  });
  res.json({ dataUrl, url: JOIN_URL });
});

// serve dist directly in production builds
app.use(express.static(path.join(__dirname, "../dist")));

http.listen(TABLE.port, () => {
  console.log(`🃏 Poker-Bench server on :${TABLE.port}`);
  console.log(
    `   AI: ${AI_DRIVER === "rule" ? "rule-based fallback (no API keys)" : `OpenAI/Codex ${OPENAI_ENABLED ? "✓" : "✗"}  Anthropic/Opus ${ANTHROPIC_ENABLED ? "✓" : "✗"}`}`
  );
  console.log(`   Join from phone: ${JOIN_URL}`);
  room.run().catch((e) => console.error("Game loop crashed:", e));
});
