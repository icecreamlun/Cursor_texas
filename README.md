# 🃏 Codex Poker Bench

**A live arena where frontier LLMs sit down at a real No-Limit Texas Hold'em table — and bluff, lie, and read each other in front of a crowd.**

Most LLM benchmarks score a model alone, on a fixed answer. Poker doesn't work like that. To win you have to model *other minds*: track who bluffs, who only bets the nuts, who folds under pressure — and then weaponize a face that says the opposite of your hand. This project turns that into a spectator sport.

Four AI seats — **OpenAI Codex (GPT‑5.x)** vs **Anthropic Opus (4.7 / 4.8)** — play hundreds of hands at the same table, with the same rules, same prompt, same blinds. Two more seats are open: **anyone can scan a QR code and join from their phone.**

---

## The hook: two channels, and a one-way mirror

Every model plays through **two separate channels**, exactly like a real player:

- 🗣️ **PUBLIC** — what the whole table sees: a line of table talk and a displayed emotion. This is a *performance*. Models are explicitly allowed to lie, slow-roll, fake confidence holding trash, or act scared holding the nuts.
- 🧠 **PRIVATE** — an inner monologue nobody at the table can see: the real read, the real plan, the real fear.

The twist for the audience: a **God View** drawer on the big screen lets *you* peek behind the one-way mirror — you watch a model coldly think *"I have nothing, but The Rock always folds to a big bet here"* in private while it grins and shoves all-in in public. Watching frontier models deceive each other, and seeing exactly how, is the whole show.

## Persistent memory = real reads

This isn't stateless prompting. **Each seat carries its own memory across the entire session.** Every model remembers every hand it has played, its own past reasoning, and the reads it has built on each specific opponent — and it's told to adapt. Bluff and get caught on hand 12, and you'll be paid off less on hand 80. The longer the session runs, the more the table dynamics start to look like a real game.

- **Codex seats** use one persistent **Codex thread per seat** — server-side conversation memory, for free.
- **Opus seats** use a per-seat rolling **message history** to reconstruct the same effect.

## A genuine cross-vendor benchmark

Seats are routed to a driver purely by model id (`opus|claude|sonnet|haiku` → Anthropic, everything else → OpenAI/Codex), so adding a contender is a one-line change in `server/config.ts`. Same table, same information, same decision schema — the only variable is the brain. Token usage is tallied per vendor for a live cost estimate.

---

## How Codex is used here (the interesting part)

Codex is normally a coding agent that reads files, runs commands, and hits the network. Here it's **repurposed as a locked-down pure-reasoning engine**:

- **Sandboxed to nothing** — `sandboxMode: "read-only"`, `networkAccessEnabled: false`, `webSearchEnabled: false`, `approvalPolicy: "never"`. No tools, no files, no shell. Just reasoning.
- **API-billed, not subscription** — `preferred_auth_method: "apikey"` forces it onto `OPENAI_API_KEY` and ignores any local ChatGPT login.
- **Strict structured output** — every turn returns a schema-validated JSON decision (`action / amount / monologue / say / emotion`) via `outputSchema`, so there's no regex-scraping of prose.
- **One thread per seat** — persistent memory, as above.
- **Reasoning effort is a dial** — `reasoningEffort` per seat is a first-class axis of the benchmark.

If a model call times out or errors, the seat **falls back to a rule-based driver** so the table never stalls mid-demo.

---

## Quickstart

```bash
# 1. install
npm install

# 2. add your keys (root .env — gitignored)
cat > .env <<'EOF'
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
EOF

# 3. run server + web together
npm run dev
```

Then:

- **Big screen / host view:** open <http://localhost:5173> and hit **Start**. Four AIs will start playing immediately — humans are optional.
- **Join from a phone:** scan the QR code on screen (or open the printed `http://<lan-ip>:5173/#/play`) to take a seat. Humans get a 60s action timer.
- **God View:** toggle "Peek inside their heads" to reveal live inner monologues + hole cards.

> No keys? The table still runs — every seat quietly falls back to the rule-based bot, so you can demo the full UI offline.

## Configuration

Everything you'd want to change lives in **`server/config.ts`**:

```ts
export const AI_SEATS = [
  { name: "The Professor", modelId: "gpt-5.5",        reasoningEffort: "low", persona: "professor" },
  { name: "Mad Max",       modelId: "claude-opus-4-8", reasoningEffort: "low", persona: "maniac" },
  { name: "The Rock",      modelId: "gpt-5.4",        reasoningEffort: "low", persona: "rock" },
  { name: "Luna",          modelId: "claude-opus-4-7", reasoningEffort: "low", persona: "luna" },
];
```

Swap a `modelId`, change a persona, retune blinds / timers / table pacing — all in one file.

## Other commands

```bash
npm run sim                       # headless: simulate a few hands in the terminal (SIM_HANDS=5)
npx tsx server/checkModels.ts     # 1 decision per seat — verifies keys + model ids + parsing
COST_HANDS=3 npx tsx server/costReport.ts   # play N hands, report per-vendor token cost
```

## Architecture

```
server/
  index.ts            Express + Socket.io; serves the big screen, streams snapshots, /api/qr
  config.ts           seats, models, blinds, timers — the one file you edit
  game/
    table.ts          poker engine wrapper (poker-ts): deck, betting, showdown
    loop.ts           the game loop: turn order, memory reset, hand settlement, banners
  ai/
    driver.ts         routes each seat to its provider; rule-based fallback + timeouts
    codexDriver.ts    OpenAI Codex SDK — sandboxed, thread-per-seat, structured output
    anthropicDriver.ts Anthropic SDK — per-seat message history, structured output
    ruleDriver.ts     heuristic bot used when a model is unavailable / times out
    personas.ts       the four table characters (style + aggression)
web/                  Vite + React: big-screen TableView, phone PlayView, God View
```

**Stack:** TypeScript · Node · Express · Socket.io · React · Vite · `poker-ts` · `@openai/codex-sdk` · `@anthropic-ai/sdk`

---

*Built for the OpenAI Codex Lab. The most honest thing at the table is the inner monologue — and only the audience gets to read it.*
