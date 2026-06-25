// console simulation: 4 AIs auto-play N hands, validates the engine + decision layer
// usage: npm run sim (defaults to rule driver; set CURSOR_API_KEY to use the Cursor SDK)
import { GameRoom } from "./game/loop.js";
import { cardText } from "./game/table.js";
import { TABLE } from "./config.js";

// speed up: shorten presentation delays
TABLE.interHandDelayMs = 200;
TABLE.aiMinThinkMs = 0;
TABLE.interTurnDelayMs = 0;

const HANDS = Number(process.env.SIM_HANDS ?? 5);
const room = new GameRoom();
room.started = true; // console simulation: skip the lobby gate, start playing directly

let lastBanner = "";
room.onSnapshot = (snap) => {
  if (snap.banner && snap.banner !== lastBanner) {
    lastBanner = snap.banner;
    console.log(`  📢 ${snap.banner}`);
  }
  const lastMono = snap.monologues[snap.monologues.length - 1];
  if (lastMono && lastMono.id > (room as any)._printedMono) {
    (room as any)._printedMono = lastMono.id;
    console.log(
      `  💭 [${lastMono.street}] ${lastMono.name}: ${lastMono.monologue} → ${lastMono.action}${lastMono.amount ? " " + lastMono.amount : ""}${lastMono.say ? ` (says: "${lastMono.say}")` : ""}`
    );
  }
  if (snap.street === "showdown" && snap.showdown) {
    for (const r of snap.showdown) {
      const p = snap.players.find((p) => p.seat === r.seat);
      console.log(`  🃏 ${p?.name}: ${r.cards.map(cardText).join(" ")} ${r.handName ?? ""}`);
    }
  }
};
(room as any)._printedMono = 0;

const origPlayHand = (room as any).playHand.bind(room);
let played = 0;
(room as any).playHand = async function () {
  console.log(`\n===== Hand #${room.handNumber + 1} =====`);
  await origPlayHand();
  const snap = room.buildSnapshot();
  console.log(
    `  Chips: ${snap.leaderboard.map((r) => `${r.name}=${r.stack}(${r.profit >= 0 ? "+" : ""}${r.profit})`).join("  ")}`
  );
  if (++played >= HANDS) {
    console.log(`\n✅ ${HANDS} hands simulated, engine OK`);
    process.exit(0);
  }
};

room.run().catch((e) => {
  console.error("❌ Simulation failed:", e);
  process.exit(1);
});
