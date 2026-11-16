<div align="center">

# 🎭 opencode-spoof

### Use your own opencode models — free ones included — from **any** OpenAI-compatible app.

**Native tool calling · Streaming · Reasoning · Subagents · Zero config**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#quick-start)
[![Runtime](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![Status](https://img.shields.io/badge/status-experimental-orange.svg)](#-limitations)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

```text
  your harness / chatbot / script
              │   OpenAI Chat Completions
              ▼
   http://127.0.0.1:8788/v1        ←  this proxy
              │   one direct HTTPS call
              ▼
   opencode.ai/inference/openai/v1
       your account · your quota
```

</div>

---

## 🤔 The problem

opencode gives you free AI models — but only **inside opencode**. Call the same model from Cursor, Open WebUI, Chatbox, your own agent, or your chatbot and the server answers:

> `Free usage limit reached. Free models work in OpenCode`

Copying the headers doesn't help. Running opencode in the background and piping prompts into it works, but then **opencode's agent runs its own tools**, so your harness's tools, your subagents, and your file access all break.

This project fixes that second half: it talks to opencode's model endpoint **directly** — your messages, your tools, your parameters — while satisfying the four server-side checks that make the free tier work outside the TUI.

## ✨ Features

| | |
| --- | --- |
| 🔌 **Drop-in OpenAI API** | `POST /v1/chat/completions`, `GET /v1/models` — point any OpenAI SDK at it |
| 🛠️ **Native tool calling** | Your function schemas go out, your tool names come back. Subagents work. |
| 🌊 **Streaming** | Real SSE with `[DONE]`; non-streaming clients are aggregated transparently |
| 🧠 **Reasoning** | `reasoning_content` / `reasoning` deltas, `reasoning_effort`, `#high` / `#max` variants |
| 🔁 **Auto token refresh** | Rotates opencode's OAuth credential and writes it back, so the CLI stays in sync |
| 🪶 **Zero npm deps** | `spoof.mjs` uses Bun built-ins only — no supply chain to trust |
| 🩺 **Self-checking** | One-click setup verifies Bun, sign-in, session freshness, and prompt drift |
| 💸 **Free stays free** | Uses your existing quota — no extra accounts, no resale, no magic |

## 🚀 Quick start

**Prerequisites** — [opencode](https://opencode.ai) installed, signed in to OpenCode Console, and used at least once (send one message in it). [Bun](https://bun.sh) installed (`npm install -g bun`).

```text
┌──────────────────────────────────────────────────────────────┐
│  Windows            double-click  setup.cmd                  │
│  macOS / Linux      ./setup.sh                                │
│  Manual             bun run check && bun run start            │
└──────────────────────────────────────────────────────────────┘
```

You get a preflight report, then the proxy:

```text
  ✓ Bun 1.4.4
  ✓ signed in as you@example.com / Default
  ✓ newest opencode session is 3 min old
  ✓ prompt matches installed opencode 2.2.5

opencode spoof proxy v2 listening on http://127.0.0.1:8788
  tools merged  : 1 opencode tools kept
  prompt drift  : none
```

Verify end to end:

```sh
bun run test        # streaming + custom tool → prints tool_calls and real usage
```

### Connect anything

| Setting | Value |
| --- | --- |
| **Base URL** | `http://127.0.0.1:8788/v1` |
| **API key** | anything (`opencode`) |
| **Model** | `glm-5.3-flash-free` · `deepseek-v4.1-flash-free` · [50+ live models](http://127.0.0.1:8788/v1/models) |

```js
import OpenAI from "openai"
const client = new OpenAI({ baseURL: "http://127.0.0.1:8788/v1", apiKey: "opencode" })

const res = await client.chat.completions.create({
  model: "glm-5.3-flash-free",
  messages: [{ role: "user", content: "Read package.json and summarize it" }],
  tools: [{ type: "function", function: { name: "Read", description: "Read a file",
    parameters: { type: "object", properties: { file_path: { type: "string" } } } } }],
  stream: true,
})
```

Works with **ZCode, Open WebUI, Chatbox, Jan, LM Studio, SillyTavern, LangChain, CrewAI**, and anything else that speaks OpenAI. Click-by-click instructions: **[docs/SETUP.md](docs/SETUP.md)**.

## 🧠 How it works, in one table

The free tier validates exactly four things. This is measured, not guessed — the full research log with every dead end is in **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**.

| # | What the server checks | What the proxy does |
| --- | --- | --- |
| 1 | `messages[0]` starts with an opencode system prompt | prepends it, then hands control back with an override; your prompt follows |
| 2 | `stream: true` | always streams upstream, reassembles for non-stream clients |
| 3 | a **recent real** session ID | borrows the newest one from opencode's own DB |
| 4 | a tool named exactly `read`; no extra `Read`/`Edit` | sends one neutered `read` stub, renames yours in flight and maps back |

Everything else — headers, TLS, header order, JSON key order, project ID, temperature, tool count, message count — was tested and proven irrelevant.

## 📦 Monorepo layout

```text
opencode-spoof/
├── setup.cmd / setup.sh      ← one-click setup (checks + start)
├── refresh-models.cmd        ← build models.md / models.json (works standalone)
├── packages/
│   ├── spoof/                ← the direct API proxy  (port 8788)
│   │   ├── spoof.mjs
│   │   ├── agent-prompt.json ← whitelisted prompt + source version
│   │   ├── setup-check.mjs
│   │   ├── test-spoof.mjs
│   │   └── start.cmd
│   └── bridge/               ← session bridge        (port 8787)
│       ├── bridge.mjs        ← prompts through a real opencode session
│       ├── refresh-models.mjs ← standalone catalog refresh
│       ├── probe-models.mjs
│       └── start.cmd
└── docs/
    ├── SETUP.md              ← for non-nerds
    ├── PLAIN-ENGLISH.md      ← the whole story, no jargon
    └── HOW-IT-WORKS.md       ← research log + re-derivation guide
```

**Which one do I want?**

| | `packages/spoof` | `packages/bridge` |
| --- | --- | --- |
| Your harness's tools | ✅ native | ❌ opencode runs its own |
| Subagents / MCP / file tools | ✅ | ❌ |
| Stateless | ✅ | ❌ opencode sessions |
| Use when | always, unless you specifically want opencode's agent | you want opencode's tools & session files |

## ⚠️ Limitations

- **Prompt overhead:** ~14.7 KB (≈3.5K tokens) prepended per request, mostly prompt-cached.
- **Session freshness:** the borrowed session expires if opencode isn't used for ~a day; open it once and it works again.
- **Tool renaming:** tools literally named `Read`/`Edit` travel as `view_file`/`apply_patch` and are mapped back.
- **Version drift:** the prompt is version-specific. The proxy warns when your opencode version differs from the captured one; refresh recipe in [HOW-IT-WORKS §2/§10](docs/HOW-IT-WORKS.md).
- **Quota is per-IP and shared** with your opencode app. This does not create more AI — it just lets you use what you have from anywhere.

## 🛑 Honest disclaimer

This is a **compatibility tool for your own account**. It makes requests look like they came from opencode's own client. opencode intends free models to be used inside opencode, so this is very likely a **terms-of-service violation**, and they can change the checks at any time.

- Use **your own** credentials. Never share your `opencode.db`.
- Don't sell access, don't run it for others, don't hammer the free tier.
- No warranty; if it breaks after an update, that's expected — the research notes exist so it can be fixed.

If you're not comfortable with that trade, the sanctioned alternatives are the paid Zen API (`https://opencode.ai/zen/v1`) or any provider key you already own.

## ❓ FAQ

**Will it work for someone who clones it?** Yes — no credentials in the repo. Their copy uses their login, their session, their quota. They need opencode installed, signed in, and used once.

**What's the latest opencode version?** npm `@opencode/cli` is **2.3.0** (Nov 2026); this prompt was captured from **2.2.5**, and `setup-check` flags any mismatch.

**Does it secretly send extra requests?** No — one in, one out. Only a single retry after a 401 token refresh, plus one retry if the first connection dies fast.

**Why not just use the paid API?** Because you have free models and want them in your own tools. That's the whole point.

## 🧪 Development

```sh
bun run check     # preflight
bun run start     # spoof proxy  :8788
bun run bridge    # session mode :8787
bun run test      # SDK + streaming + tool call
```

Diagnostics: `packages/bridge/probe-models.mjs` lists every model the local service exposes.

## Contributing

Issues and PRs welcome — especially:
- fresh prompt captures when opencode ships a new version
- client-specific setup instructions (add yours to `docs/SETUP.md`)
- bug reports with `OPENCODE_SPOOF_DEBUG=1` logs

⭐ **If this saves you a subscription or a headache, star the repo** — it helps other people find it.

## License

MIT — see [LICENSE](LICENSE). The system prompt in `packages/spoof/agent-prompt.json` belongs to opencode and is included only as a runtime compatibility artifact.
