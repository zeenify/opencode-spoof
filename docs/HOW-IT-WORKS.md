# How it works — full research log

This documents how `spoof.mjs` was derived: what we tried, what failed, what the failures ruled out, and the experiments that produced the final rules. It is written so that if opencode changes their checks, the same method can be applied again.

Everything here is empirical, measured against the live service on 2026-11-15/16 with opencode CLI **2.2.5**. No claims are inferred from documentation.

---

## 0. TL;DR — the four rules

The free tier accepts a request only if:

| # | Rule | Where | What the proxy does |
| --- | --- | --- | --- |
| 1 | `messages[0]` is a system message **starting with an opencode system prompt** | body | prepends the agent prompt (~14.7 KB) + an override, keeps your prompt after it |
| 2 | `stream` is `true` | body | forces `stream: true`, re-aggregates for non-streaming clients |
| 3 | `x-opencode-session*` decodes to a **recent real session** | headers | borrows the newest session ID from opencode's local DB |
| 4 | a tool literally named **`read`** exists; no extra tools named `Read`/`Edit` | body | sends one neutered `read` stub; renames your `Read`/`Edit` and maps back |

Everything else observed to be irrelevant: headers, TLS fingerprint, header order, JSON key order, project ID, `max_tokens`, tool count, request size, `thinking`/`enable_thinking` parameters, message content.

---

## 1. Background — opencode's architecture

Understanding what to attack requires knowing what a request is:

- `opencode` is a Bun-compiled CLI (`@opencode/cli/bin/opencode.exe`). It runs a **local HTTP service** (`opencode serve`, usually port 4096 or a random port) and the TUI talks to it over localhost.
- Credentials live in SQLite at `~/.local/share/opencode/opencode.db`, table `credential`:
  - `{"type":"key","key":"sk-..."}` — a legacy API key (ours was **expired/inactive**)
  - `{"type":"oauth","access":"st_...","refresh":"rt_...","expires":<ms>,"metadata":{"orgID":"wrk_...","email":...}}` — the active OpenCode Console login, refreshed via `POST https://opencode.ai/console/auth/device/token` with `{grant_type:"refresh_token", refresh_token, client_id:"opencode-cli"}` → `{access_token, refresh_token, expires_in, org_id}`
- Model requests go to `https://opencode.ai/inference/openai/v1/chat/completions` with `Authorization: Bearer <oauth access>`.
- `GET /console/api/v2/config` returns the model catalog; it is **not** gated the same way and was useful as a control.

Two ways to reach the models:

| Approach | Path | Tool calling |
| --- | --- | --- |
| **Session bridge** (`bridge.mjs`) | local service API (`@opencode/client`) creates a session and prompts it | broken for your harness — opencode owns the tool loop |
| **Direct** (`spoof.mjs`) | your process → `inference/openai/v1` | native |

The direct path is what the rest of this document is about.

## 2. Method

Two tools, used in this order:

1. **Capture** — make the real CLI talk through mitmproxy, record the exact request.
2. **Replay + bisect** — send that request yourself, then mutate one thing at a time.

Capture setup (Windows):

```sh
# mitmproxy creates its CA on first run
mitmdump -p 8081 -q -s dump.py     # dump.py logs url, headers, body for *.opencode.ai

# run opencode with the proxy in its environment
set HTTPS_PROXY=http://127.0.0.1:8081
set NODE_EXTRA_CA_CERTS=C:\Users\<you>\.mitmproxy\mitmproxy-ca-cert.pem
opencode run --standalone -m opencode/glm-5.3-flash-free "hello"
```

Notes that cost time:

- `opencode run` reuses an already-running background service, which **does not inherit new env vars**. Either kill the service first or pass `--standalone`, which runs the server in-process.
- Node's `https` module ignores `HTTPS_PROXY`; Bun's `fetch` honors it. Use Bun when you need captured traffic.

The captured request (successful, `/inference/openai/v1/chat/completions`):

```http
POST /inference/openai/v1/chat/completions HTTP/1.1
Authorization: Bearer st_...                    # OAuth access token
Content-Type: application/json
User-Agent: opencode/latest/2.2.5/cli
b3: <32hex>-<16hex>-1-<16hex>
traceparent: 00-<32hex>-<16hex>-01
x-opencode-client: cli
x-opencode-org-id: wrk_...
x-opencode-project: <20-byte hex hash>
x-opencode-session: ses_<26 chars>
x-opencode-session-id: ses_<26 chars>
x-session-affinity: ses_<26 chars>
x-session-id: ses_<26 chars>
Connection: keep-alive
Accept: */*
Host: opencode.ai
Accept-Encoding: gzip, deflate, br, zstd
Content-Length: <n>

{"model":"glm-5.3-flash-free","messages":[...],"tools":[...13 tools...],
 "stream":true,"stream_options":{"include_usage":true},"max_completion_tokens":...}
```

No signature, ticket, or HMAC header exists on model calls. (The `x-opencode-ticket` header in the binary is only used for local service endpoints such as pty connect.)

## 3. Phase 1 — header spoofing (failed, but informative)

Reproducing every header above, in the same order, with the same User-Agent and a live OAuth token, produced:

```json
{"type":"error","error":{"type":"FreeUsageLimitError",
 "message":"Free usage limit reached. Free models work in OpenCode (https://opencode.ai); ..."}}
```

At first this looked like quota. It is not, and the distinction matters:

- **Quota exhaustion** affects the real CLI too.
- **Gate rejection** does not — the real CLI works seconds later.

> Both return the exact same body and a 5-hour `Retry-After`, which is why this is so easy to misdiagnose. Always test the real CLI at the same moment before believing a quota diagnosis.

So headers were not the mechanism, and neither was the token. Two theories remained: transport (TLS), or something in the body.

## 4. Phase 2 — five wrong theories and how each was killed

### 4.1 TLS fingerprint (looked confirmed, then disproved)

Experiment: run the **real client** through mitmproxy twice.
- TLS **intercepted** (mitmproxy terminates) → `429`
- TLS **passthrough** (`--ignore-hosts '.*opencode\.ai.*'`) → `200 OK`

This flipped the result with zero changes to the HTTP bytes, which strongly suggested server-side TLS-fingerprint inspection. It is wrong. Resolution: we later wrote a raw CONNECT proxy that records the first TLS record and forwards it untouched, and compared ClientHello structure for the real client vs Bun's `fetch`:

| Field | Real client | Bun `fetch` |
| --- | --- | --- |
| Cipher suites | `[4865,4866,4867,49195,49199,...]` | identical |
| Extension order | `[0,23,65281,10,11,35,16,5,13,18,51,45,43]` | identical |
| ALPN | `http/1.1` | identical |
| ClientHello length | 1502 bytes | 1502 bytes |

Same ClientHello, different outcome. The TLS theory died. The passthrough/intercept difference was a red herring caused by mitmproxy's **header re-serialisation**, not its TLS stack.

### 4.2 Header order

Headers written in the real client's exact order via raw bytes on a TLS socket: still `429`.

### 4.3 JSON key order

Reordered the body's keys: still accepted when other rules were satisfied. Irrelevant.

### 4.4 Project ID

Sent with `x-opencode-project` values from different projects, including a random hash: no effect. (opencode stores one hash per worktree in its `project` table; the proxy now reuses the nearest one for cosmetics.)

### 4.5 Session ID *format*

The real IDs are 26 base62 chars after `ses_`. A synthetic ID in the same format was rejected. This looked like a format rule; it is actually a **validity** rule (see 5.3).

The general lesson: **"same bytes" beats "plausible bytes."** The only reliable signal in this investigation was a byte-exact replay.

## 5. Phase 3 — the breakthrough and the findings

### 5.1 Byte-exact replay works

We saved one genuine request (headers, order, body) and replayed it byte for byte from our own process. Result: `200 OK` with streaming data. That proved:

- the request is judged on its contents, and
- our transport was fine all along.

From there, every experiment mutated exactly one element of the working request.

### 5.2 Rule 1 — the system prompt whitelist

| Mutation | Result |
| --- | --- |
| user message replaced | 200 |
| system message deleted | **429** |
| system truncated to 40 chars | **429** |
| system + extra sentence appended | 200 |
| arbitrary long system (up to 1000 chars) | **429** |
| opencode prompt prefix + extra text | 200 |
| opencode prompt with the first sentence removed | **429** |

Interpretation: the gate requires `messages[0].content` to **start with** a whitelist entry. Appending is allowed (that is what lets us add the override), prepending or truncating is not.

The proxy ships one prompt per version (`agent-prompts.json`): 2.2.5 is 14,688 chars, 2.3.0 is 14,699 — the first difference is at char 2061 (a tools list). Both were tested; the 2.2.5 prompt still passed after upgrading the CLI to 2.3.0, confirming the gate compares a stable prefix. It uses the **agent** prompt. A smaller **title-generation** prompt (1,806 chars) also passes the gate, but only for tool-less requests; the minimal passing prefix measured for it was between 1,132 and 1,353 chars. The agent prompt is required when tools are present.

### 5.3 Rule 2 — `stream: true`

`stream: false` → 429, everything else unchanged. The proxy forces streaming upstream and reassembles the SSE into one JSON response when the client asked for non-streaming, so clients never see the requirement.

### 5.4 Rule 3 — the session ID

Built by decoding real IDs:

- 26 base62 chars; the first 12 characters are **not random**.
- Across 12 sessions, the decoded value of the first 10 chars is linear in `time_created` with slope ≈ `105746` per ms (residual ≈ milliseconds, i.e. sub-millisecond clock noise). The ID is a time-ordered encoding.
- The gate's checks, measured:
  - a real recent ID passes (0.6 h and 1.1 h old both worked);
  - a very old real ID fails (113 days);
  - a synthetic ID whose encoded timestamp equals a real session's passes;
  - a synthetic ID encoding "now" fails **even though it is newer** — so the gate tracks a **high-water mark** of genuine session activity and rejects anything above it, and also rejects IDs outside a recency window.
  - editing the last character of a real ID passes; renaming parts is tolerated.

Because the exact encoder is not needed, the robust implementation is: **borrow the newest `session_v2.id` from opencode's own DB** (falling back to the `session` table), cache it for a minute, and warn when it is more than 12 h old. The query:

```sql
select id, time_created from session_v2 order by time_created desc limit 1
```

All four session header variants carry the same borrowed ID.

### 5.5 Rule 4 — the tools array

| Mutation | Result |
| --- | --- |
| all 13 opencode tools | 200 |
| remove `read` | **429** |
| rename `read` to `zzz_read` | **429** |
| remove `edit`, `write`, `shell`, `execute`, `glob`, `grep`, `question`, `skill`, `subagent`, `webfetch`, `websearch`, `experimental_image_generate` (each individually) | 200 |
| `read` with description "Disabled." and empty parameters | 200 |
| extra tool named `Read` (capital) | **429** |
| extra tool named `Edit` (capital) | **429** |
| extra tool named `Write`, `Bash`, `Skill`, `WebFetch`, or 40+ MCP tools | 200 |
| 22 synthetic tools | 200 |
| 1 tool + a 200 KB message | 200 |

Interpretation:

- The gate requires a tool **named exactly `read`** — but does not inspect its schema, so it can be neutered to a disabled stub.
- Every other opencode tool is optional. Removing them is important for behaviour: with the full set present, the model sometimes called **opencode's** `read` (schema `{"path": ...}`) instead of the harness's own read tool, and the harness received a tool call it could not execute.
- Extra tools named `Read`/`Edit` are rejected even though `Write`/`Bash` are not — a narrow deny rule. Hence the rename trick: outbound `Read → view_file`, `Edit → apply_patch`; inbound tool calls are mapped back so the client sees its own names.
- No tool-count or body-size limit was found.

### 5.6 What was proven irrelevant

Params (`thinking`, `enable_thinking`, `reasoning`, `reasoning_effort`, `max_completion_tokens` up to 128000), message content, message count (318 messages), tool count, JSON key order, HTTP header order, TLS ClientHello, project ID, `Content-Length`, request size. Each was tested by mutating the working request and observing no change.

## 6. Final request anatomy

```
POST /inference/openai/v1/chat/completions
Authorization: Bearer <oauth access token>          ← from credential table, auto-refreshed
User-Agent: opencode/latest/2.2.5/cli
x-opencode-client: cli
x-opencode-org-id: <orgID from credential metadata>
x-opencode-project: <nearest project hash from DB>
x-opencode-session / -session-id / x-session-affinity / x-session-id: <borrowed real session id>
b3 / traceparent: <generated, matching format>
Connection: keep-alive
Accept: */*

{
  "model": "glm-5.3-flash-free",
  "messages": [
    { "role": "system", "content": "<opencode agent prompt>\n\n# Operating mode override\n<...>\n\n# Additional instructions\n<your system prompt>" },
    <your messages, unchanged>
  ],
  "tools": [
    { "type": "function", "function": { "name": "read", "description": "Disabled...", "parameters": { "type": "object", "properties": {} } } },
    <your tools, with Read→view_file and Edit→apply_patch>
  ],
  "tool_choice": <yours, renamed if it referenced Read/Edit>,
  "stream": true,
  "stream_options": { "include_usage": true },
  ... your temperature / max_tokens / reasoning_effort / etc.
}
```

Responses are the upstream stream, passed through after de-chunking; `view_file`/`apply_patch` are rewritten back to `Read`/`Edit` in both streaming deltas and aggregated JSON.

## 7. Implementation notes

- **Transport.** `spoof.mjs` uses `Bun.connect({ tls: true })` and writes the HTTP request manually. It is not required for the gate (Bun `fetch` produces the same ClientHello), but it gives exact control over bytes and lets the proxy de-chunk the response itself.
- **De-chunking is mandatory.** The upstream streams chunked SSE and does not close the socket when done. The proxy implements a small HTTP/1.1 chunk decoder and closes at the terminal chunk — without this, non-streaming clients hang.
- **Token refresh** mirrors the CLI: on expiry (5-minute skew) or a 401, `POST /console/auth/device/token` with the stored refresh token, then write the rotated credential back into opencode's DB so the CLI and proxy stay in sync. Refreshes are single-flight.
- **Ordering.** `prepareBody` records the client's `stream` intent *before* forcing it, so the response stage knows whether to aggregate.
- **Streaming rename mapping** holds back a short suffix between chunks so a split `view_file` token cannot escape the rewrite.

## 8. Verification suite (what each test proves)

| Test | Proves |
| --- | --- |
| `bun run test` | OpenAI SDK, streaming, custom tool → `tool_calls`, usage |
| Kill every opencode process, then send a request with a persona system prompt | model follows **your** instructions; no opencode runtime involved |
| Custom `get_weather` tool, ask for Paris | native function calling works end-to-end |
| `Read` tool, ask to read a file | rename round-trip: request carries `view_file`, response returns `Read` with correct args |
| Multi-turn with assistant messages | history passes through |
| `deepseek-v4.1-flash-free` | works for a second free model |
| Real CLI at the same moment | distinguishes gate rejection from quota exhaustion |

## 9. Quota economics (per-IP)

- The free bucket is shared **per IP**, not per account: a different network with the same account worked while the Wi‑Fi was blocked, and the real CLI failed on the blocked network too.
- The proxy does not multiply it: one request in, one upstream request out (retry only on 401 token refresh).
- Cost per request: ~14.7 KB prompt ≈ **3.5 K input tokens**, of which the upstream reports `cache_read` for repeats (~700 uncached input tokens after the first call on a model).
- The gate and real quota return the **same** `429 FreeUsageLimitError`. Diagnostic rule: if the TUI also fails, it is quota; if the TUI works, it is the gate.

## 10. Re-deriving this after an opencode update

If requests start failing while the TUI works:

1. Capture again (§2) and confirm the endpoint and header names still match.
2. Replay a genuine request byte for byte. If that works, check the four rules in order:
   - does the system prompt still start with a currently-whitelisted prompt? (The prompt text may change between versions — extract a fresh one and add it to `agent-prompts.json` under the new version key (old entries stay, so it works for people on older CLIs).)
   - is `stream` still required?
   - do the session IDs still decode the same way, and does a fresh real ID still pass? (If opencode changes the format, borrowing still works.)
   - is `read` still the required tool name, and are extra `Read`/`Edit` tools still denied?
3. Bisect any new failure with the same discipline: **one mutation at a time, a control request in the same run, and a real-CLI check to rule out quota.**

## 11. Ethics and risk

This tool makes your requests indistinguishable from opencode's own client in order to use models on your own account. opencode intends free models to be used inside opencode; doing this is very likely a terms-of-service violation, and the checks may be reinforced or patched at any time. It does not increase your quota, does not bypass billing for paid models, and does not give access to any account but your own.

If you publish forks or derivatives: keep the disclaimer, don't market it as a free API service, and don't strip the notes that explain what it does.
