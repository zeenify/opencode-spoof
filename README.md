# opencode-spoof

Use the models from **your own [opencode](https://opencode.ai) account** — including the free ones — from any OpenAI-compatible client, chatbot, or agent harness, **with native tool calling**.

It exposes a local OpenAI-compatible API (`http://127.0.0.1:8788/v1`) and calls opencode's own inference endpoint directly, using the credentials already on your machine. No opencode process runs; your harness keeps its own tool loop, so subagents, file tools, and MCP tools work.

```text
your harness ──► http://127.0.0.1:8788/v1 ──► opencode.ai/inference/openai/v1
                                              (your account, your quota)
```

---

> ## ⚠️ Read this before using
>
> - **This is a compatibility tool for your own account, not "free AI for everyone".** It works by making requests look like they came from opencode's own CLI. opencode intends free models to be used inside opencode; doing this very likely violates their terms, and they can change or block the checks at any time.
> - **Your quota is not increased.** Every call spends the same free bucket as your opencode TUI — it is shared per IP address. Heavy use drains it for every device on that network.
> - **Use your own credentials.** Never run this against someone else's account, never share your `opencode.db`, and do not sell access.
> - **No warranty.** If this breaks after an opencode update, that is expected. The [research notes](docs/HOW-IT-WORKS.md) explain how it was derived so it can be re-derived.
> - Do not publicly repackage this as a paid service or a bulk "free API".

---

## Requirements

- [Bun](https://bun.sh) — `npm install -g bun`
- opencode installed and signed in on the same machine (`opencode auth list` shows **OpenCode Console**)
- Use opencode at least once recently — the proxy borrows one of your real opencode session IDs (see [limitations](#limitations))

## Quick start

```sh
git clone <this repo> opencode-spoof
cd opencode-spoof
npm install          # only needed for the session-mode bridge and the test script
bun spoof.mjs        # or double-click start-spoof.cmd on Windows
```

You should see:

```text
opencode spoof proxy v2 listening on http://127.0.0.1:8788
  upstream      : https://opencode.ai/inference/openai/v1
  identity      : opencode/latest/2.2.5/cli
  prompt inject : on (14688 chars + override)
  tools merged  : 1 opencode tools kept
  creds         : C:\Users\<you>\.local\share\opencode\opencode.db
  account       : you@example.com / Default
```

Sanity check:

```sh
bun test-spoof.mjs
```

It sends a streaming request with a custom tool and prints text, reasoning, `tool_calls`, and usage. A healthy run ends with `✓ proxy works`.

## Connect any client

| Setting  | Value                                    |
| -------- | ---------------------------------------- |
| Base URL | `http://127.0.0.1:8788/v1`               |
| API key  | any non-empty string (ignored locally)   |
| Model    | `glm-5.3-flash-free` (or any model from `GET /v1/models`) |

```sh
curl http://127.0.0.1:8788/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-5.3-flash-free",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

JavaScript (official OpenAI SDK):

```js
import OpenAI from "openai"

const client = new OpenAI({ baseURL: "http://127.0.0.1:8788/v1", apiKey: "opencode" })

const res = await client.chat.completions.create({
  model: "glm-5.3-flash-free",
  messages: [{ role: "user", content: "Hello" }],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  }],
  stream: true,
})

for await (const chunk of res) process.stdout.write(chunk.choices[0]?.delta?.content ?? "")
```

Point agent harnesses at the same base URL. The proxy speaks plain OpenAI Chat Completions: your `messages`, `tools`, `tool_choice`, `temperature`, `max_tokens`, `stop`, and `reasoning_effort` all pass through, and tool calls come back under **your** tool names.

### Effort levels and models

- `GET /v1/models` — live upstream catalog (51 models, with `capabilities` including `tools` and `reasoning.effort`)
- `reasoning_effort: "high"` — or pin it in the model name: `glm-5.3-flash-free#max`
- Model names are provider-prefix tolerant: `glm-5.3-flash-free`, `opencode/glm-5.3-flash-free`, `anything/glm-5.3-flash-free` all work
- Tested working: `glm-5.3-flash-free`, `deepseek-v4.1-flash-free`

## Two modes

| Mode | Entry point | Port | Native tool calling | When to use |
| --- | --- | --- | --- | --- |
| **Spoof** (recommended) | `spoof.mjs` | 8788 | **yes** | Any harness, chatbot, or script. Stateless, direct API. |
| Session bridge | `bridge.mjs` | 8787 | no | When you want opencode's own agent, tools, and session files in the loop. |

The session bridge runs prompts through a real opencode session via `@opencode/client`; it works too, but it cannot forward *your* harness's tools (opencode owns its tool loop). The spoof proxy is the one that makes models feel native everywhere.

## How it works (summary)

The free tier does not check what it appears to check. Measured facts, not guesses:

1. **Headers, TLS fingerprint, header order, project ID, `max_tokens` — all irrelevant.** Byte-identical requests were accepted or rejected depending only on these four things:
2. **System prompt prefix** — `messages[0]` must be a system message that begins with one of opencode's own system prompts. The proxy prepends opencode's agent prompt plus an override that hands control back to your instructions.
3. **`stream: true`** — required upstream. The proxy always streams and re-aggregates for non-streaming clients.
4. **A recent, real session ID** — the `x-opencode-session*` headers must carry an ID that decodes to a recent session created by *your* opencode. The proxy borrows the newest one from opencode's local DB.
5. **One tool named `read`** — the tools array must contain a tool literally named `read` (any schema). The proxy sends it disabled/neutered. Extra tools named `Read` or `Edit` are rejected, so those get renamed in flight and mapped back in responses.

Everything else is yours. The full investigation — including five dead ends and the experiments that disproved them — is in **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**. A jargon-free version is in **[docs/PLAIN-ENGLISH.md](docs/PLAIN-ENGLISH.md)**.

## What works

| Feature | Status |
| --- | --- |
| `POST /v1/chat/completions` | yes |
| `GET /v1/models` | yes (live upstream) |
| Streaming SSE + `[DONE]` | yes |
| Non-streaming clients | yes (aggregated transparently) |
| Native function calling (`tools`, `tool_choice`) | yes — your tool names come back |
| Multi-turn (`assistant`, `tool` messages) | yes |
| `reasoning_content` / `reasoning` output | yes |
| `reasoning_effort`, `model#high` / `#max` | yes |
| `temperature`, `top_p`, `max_tokens`, `stop`, `seed` | passed through |
| Real token usage (with `billing_source: free`) | yes |
| Token auto-refresh (OAuth) | yes |
| Embeddings, images, audio, `/v1/responses` | no |

## Limitations

- **The model sees a ~14.7 KB prompt prefix** on every request (~3.5 K tokens; mostly prompt-cached, so repeats cost ~700 tokens). An override tells it to follow your instructions, but the extra context is real.
- **Session IDs expire.** The borrowed ID must stay recent; if you don't use opencode for about a day, requests fail until you open it once more.
- **Tool-name rewriting.** Tools literally named `Read`/`Edit` are sent as `view_file`/`apply_patch` and mapped back in responses. Everything else passes untouched.
- **One `read` stub tool** is always present (disabled) because the gate requires that exact name.
- **Free quota is shared and per-IP.** Same bucket as your TUI — the proxy does not multiply it.
- **opencode can break this at any time.** See the research notes for how to re-derive.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `FreeUsageLimitError` even though the TUI works | Request shape rejected. Check `GET /health` shows `prompt_inject: true`. If you changed the code, re-check the four rules in [How it works](#how-it-works-summary). |
| `FreeUsageLimitError` and the TUI also fails | Real quota exhausted, per IP. Wait for the reset or use another network. |
| Fails after a day away | Session ID aged out — open opencode once. |
| `no active opencode OAuth connection` | Run `opencode` and sign in to OpenCode Console. |
| Proxy not starting | Port in use: `opencode-spoof` uses 8788; set `OPENCODE_SPOOF_PORT`. |
| Nothing responds | The process died. Restart with `bun spoof.mjs` / `start-spoof.cmd`. |

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `OPENCODE_SPOOF_PORT` | `8788` | Local port |
| `OPENCODE_SPOOF_HOST` | `127.0.0.1` | Bind address (keep local) |
| `OPENCODE_PROMPT_INJECT` | `1` | Set `0` to disable prompt/tool injection (requests will be rejected by the gate) |
| `OPENCODE_AGENT_PROMPT_FILE` | `./agent-prompt.json` | System prompt + required tool set |
| `OPENCODE_PROJECT_ID` | from DB | `x-opencode-project` value |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | Credential/session store |
| `OPENCODE_SPOOF_DIR` | cwd | Directory whose project ID to reuse |
| `OPENCODE_SPOOF_TIMEOUT_MS` | `600000` | Upstream timeout |
| `OPENCODE_SPOOF_DEBUG` | `0` | Set `1` to log incoming request bodies to `debug-requests.jsonl` |

## Files

| File | Purpose |
| --- | --- |
| `spoof.mjs` | The proxy (no npm dependencies, Bun built-ins only) |
| `bridge.mjs` | Session-mode bridge (OpenAI API → opencode session) |
| `agent-prompt.json` | System prompt + required tool stub, extracted from the opencode CLI's own request |
| `test-spoof.mjs` | Streaming + tool-calling smoke test |
| `start-spoof.cmd` / `start.cmd` | Windows launchers |
| `refresh-models.cmd` | Refresh and open the model catalog (session mode) |
| `docs/PLAIN-ENGLISH.md` | The whole thing explained without jargon |
| `docs/HOW-IT-WORKS.md` | Full research log: experiments, dead ends, findings, re-derivation guide |

## License

MIT — see [LICENSE](LICENSE). The system prompt in `agent-prompt.json` belongs to opencode; it is included only as a runtime compatibility artifact.
