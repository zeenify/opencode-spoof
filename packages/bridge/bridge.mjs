import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"

const PORT = Number(process.env.OPENCODE_BRIDGE_PORT ?? 8787)
const HOST = process.env.OPENCODE_BRIDGE_HOST ?? "127.0.0.1"
const WORKDIR = process.env.OPENCODE_BRIDGE_DIR ?? process.cwd()
const DEFAULT_MODEL = process.env.OPENCODE_BRIDGE_MODEL ?? "opencode/glm-5.3-flash-free"
const TIMEOUT_MS = Number(process.env.OPENCODE_BRIDGE_TIMEOUT_MS ?? 300000)
const KEEP_SESSIONS = process.env.OPENCODE_BRIDGE_KEEP_SESSIONS === "1"
const MODELS_DIR = process.env.OPENCODE_BRIDGE_MODELS_DIR ?? process.cwd()
const REFRESH_MS = Number(process.env.OPENCODE_BRIDGE_REFRESH_MS ?? 6 * 60 * 60 * 1000)

const endpoint = await Service.ensure()
const client = OpenCode.make({
  baseUrl: endpoint.url,
  headers: Service.headers(endpoint),
})

let catalog = []
let catalogUpdated = 0

function isFreeModel(m) {
  const tiers = m.cost ?? []
  if (tiers.length === 0) return false
  return tiers.every((c) => (c.input ?? 0) === 0 && (c.output ?? 0) === 0)
}

function human(n) {
  if (n == null) return "-"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function costLabel(m) {
  const tiers = m.cost ?? []
  if (tiers.length === 0) return "-"
  const c = tiers[0]
  const input = c.input ?? 0
  const output = c.output ?? 0
  if (input === 0 && output === 0) return "free"
  return `$${input} / $${output}`
}

function modelId(m) {
  return `${m.providerID}/${m.modelID}`
}

function tableFor(models) {
  const rows = [
    "| Model name to use | Label | Effort levels | Context | Max out | Tools | Input | Cost in/out (per 1M) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const m of models) {
    const efforts = (m.variants ?? []).map((v) => v.id).join(", ") || "-"
    const input = (m.capabilities?.input ?? []).join(", ") || "text"
    rows.push(
      `| \`${modelId(m)}\` | ${m.name ?? ""} | ${efforts} | ${human(m.limit?.context)} | ${human(m.limit?.output)} | ${m.capabilities?.tools ? "yes" : "no"} | ${input} | ${costLabel(m)} |`,
    )
  }
  return rows.join("\n")
}

function buildModelsMarkdown() {
  const free = catalog.filter((m) => m.providerID === "opencode" && isFreeModel(m))
  const opencodePaid = catalog.filter((m) => m.providerID === "opencode" && !isFreeModel(m))
  const others = catalog.filter((m) => m.providerID !== "opencode")
  const byProvider = new Map()
  for (const m of others) {
    if (!byProvider.has(m.providerID)) byProvider.set(m.providerID, [])
    byProvider.get(m.providerID).push(m)
  }
  const generated = new Date(catalogUpdated || Date.now()).toLocaleString()
  const lines = [
    "# opencode models",
    "",
    `Generated: ${generated}`,
    `Base URL: http://${HOST}:${PORT}/v1`,
    `Default model: ${DEFAULT_MODEL}`,
    `Total chat models: ${catalog.length}`,
    "",
    "Use the **Model name to use** column as the `model` value. To force an effort level, either pass `reasoning_effort` or append `#<level>` to the model name (for example `opencode/glm-5.3-flash-free#high`).",
    "",
    "## Free models",
    "",
    free.length ? tableFor(free) : "_None_",
    "",
    "## OpenCode paid / subscription models",
    "",
    opencodePaid.length ? tableFor(opencodePaid) : "_None_",
    "",
    "## Other providers",
    "",
  ]
  for (const [provider, models] of [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${provider}`, "", tableFor(models), "")
  }
  return lines.join("\n")
}

function buildModelsJson() {
  return {
    generatedAt: new Date(catalogUpdated || Date.now()).toISOString(),
    baseUrl: `http://${HOST}:${PORT}/v1`,
    defaultModel: DEFAULT_MODEL,
    count: catalog.length,
    models: catalog.map((m) => ({
      id: modelId(m),
      providerID: m.providerID,
      modelID: m.modelID,
      name: m.name ?? null,
      family: m.family ?? null,
      free: isFreeModel(m),
      context: m.limit?.context ?? null,
      maxOutput: m.limit?.output ?? null,
      efforts: (m.variants ?? []).map((v) => v.id),
      variantIds: (m.variants ?? []).map((v) => `${modelId(m)}#${v.id}`),
      tools: Boolean(m.capabilities?.tools),
      input: m.capabilities?.input ?? [],
      output: m.capabilities?.output ?? [],
      cost: m.cost ?? null,
      status: m.status ?? null,
      enabled: m.enabled !== false,
    })),
  }
}

async function refreshCatalog() {
  const out = await client.model.list()
  catalog = (out.data ?? []).filter((m) => m.type === "chat" && m.enabled !== false)
  catalogUpdated = Date.now()
  try {
    await Promise.all([
      Bun.write(`${MODELS_DIR}/models.md`, buildModelsMarkdown()),
      Bun.write(`${MODELS_DIR}/models.json`, JSON.stringify(buildModelsJson(), null, 2) + "\n"),
    ])
  } catch (err) {
    console.error("failed to write model catalog files:", err?.message ?? err)
  }
  return catalog.length
}

try {
  const count = await refreshCatalog()
  console.log(`catalog loaded: ${count} chat models -> ${MODELS_DIR}/models.md`)
} catch (err) {
  console.error("model.list failed:", err?.message ?? err)
}
setInterval(() => {
  refreshCatalog().catch((err) => console.error("catalog refresh failed:", err?.message ?? err))
}, REFRESH_MS)

// One shared event subscription, fanned out by sessionID.
const waiters = new Map()
let connected
const connectedPromise = new Promise((resolve) => (connected = resolve))
let subscribed = false

;(async () => {
  while (true) {
    try {
      for await (const ev of client.event.subscribe()) {
        if (!subscribed) {
          subscribed = true
          connected()
        }
        const sid = ev.data?.sessionID
        if (!sid) continue
        const w = waiters.get(sid)
        if (!w) continue
        if (ev.type === "session.text.delta") w.onDelta?.(ev.data.delta ?? "")
        else if (ev.type === "session.reasoning.delta") w.onReasoning?.(ev.data.delta ?? "")
        else if (ev.type === "session.execution.succeeded") w.onDone?.(null)
        else if (ev.type === "session.execution.failed") w.onDone?.(ev.data?.error ?? new Error("execution failed"))
        else if (ev.type === "session.execution.interrupted") w.onDone?.(new Error("execution interrupted"))
        else if (ev.type === "session.error") w.onDone?.(ev.data ?? new Error("session error"))
      }
    } catch (err) {
      if (!subscribed) {
        subscribed = true
        connected()
      }
      console.error("event stream error:", err?.message ?? err)
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
})()

await Promise.race([connectedPromise, new Promise((r) => setTimeout(r, 5000))])

function textOf(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text ?? "" : ""))
      .join("")
  }
  return ""
}

function buildPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ""
  const system = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).filter(Boolean)
  const rest = messages.filter((m) => m.role !== "system")
  if (rest.length === 1 && rest[0].role === "user" && system.length === 0) return textOf(rest[0].content)
  const parts = []
  if (system.length) parts.push(`System: ${system.join("\n\n")}`)
  for (const m of rest) {
    const label = m.role === "assistant" ? "Assistant" : m.role === "tool" ? "Tool" : "User"
    parts.push(`${label}: ${textOf(m.content)}`)
  }
  return parts.join("\n\n")
}

function findModel(name) {
  const slash = name.indexOf("/")
  if (slash > 0) {
    const providerID = name.slice(0, slash)
    const modelID = name.slice(slash + 1)
    return catalog.find((m) => m.providerID === providerID && m.modelID === modelID)
  }
  return catalog.find((m) => m.modelID === name && m.providerID === "opencode") ?? catalog.find((m) => m.modelID === name)
}

const EFFORT_ALIASES = {
  minimal: ["minimal", "none"],
  none: ["none", "minimal"],
  low: ["low"],
  medium: ["medium"],
  high: ["high"],
  xhigh: ["xhigh", "max", "maximum"],
  max: ["max", "maximum", "xhigh"],
}

function resolveRequest(body) {
  let name = body.model || DEFAULT_MODEL
  let effort = body.reasoning_effort ?? body.reasoning?.effort
  const hash = name.lastIndexOf("#")
  if (hash > 0) {
    effort ??= name.slice(hash + 1)
    name = name.slice(0, hash)
  }

  const hit = findModel(name)
  let providerID
  let modelID
  if (hit) {
    providerID = hit.providerID
    modelID = hit.modelID
  } else {
    const slash = name.indexOf("/")
    if (slash > 0) {
      providerID = name.slice(0, slash)
      modelID = name.slice(slash + 1)
    } else {
      providerID = "opencode"
      modelID = name
    }
  }

  let variant
  if (effort && hit?.variants?.length) {
    const want = String(effort).toLowerCase()
    const candidates = EFFORT_ALIASES[want] ?? [want]
    const match =
      hit.variants.find((v) => candidates.includes(String(v.id).toLowerCase())) ??
      hit.variants.find((v) => candidates.includes(String(v.settings?.reasoningEffort ?? "").toLowerCase())) ??
      hit.variants.find((v) => candidates.includes(String(v.settings?.reasoning?.effort ?? "").toLowerCase())) ??
      hit.variants.find((v) => candidates.includes(String(v.settings?.thinkingConfig?.thinkingLevel ?? "").toLowerCase()))
    variant = match?.id
  }

  return { providerID, modelID, variant, hit, effort: variant ?? effort }
}

function modelLabel(providerID, modelID) {
  return `${providerID}/${modelID}`
}

function errorBody(err) {
  const msg = typeof err === "string" ? err : err?.message ?? JSON.stringify(err ?? "unknown error")
  const s = JSON.stringify(err ?? msg)
  let status = 500
  let type = "server_error"
  if (s.includes("Free usage limit") || s.includes("429")) {
    status = 429
    type = "rate_limit_error"
  } else if (s.includes("expired") || s.includes("authentication") || s.includes("401")) {
    status = 401
    type = "authentication_error"
  } else if (s.includes("subscription") || s.includes("403")) {
    status = 403
    type = "permission_error"
  }
  return { status, body: { error: { message: msg, type, code: status } } }
}

async function runPrompt(body, handlers) {
  const { providerID, modelID, variant } = resolveRequest(body)
  const text = buildPrompt(body.messages)
  if (!text.trim()) throw new Error("No prompt content")

  const session = await client.session.create({
    location: { directory: WORKDIR },
    model: { providerID, id: modelID, ...(variant ? { variant } : {}) },
  })

  let resolveDone
  const done = new Promise((resolve) => (resolveDone = resolve))
  const waiter = {
    onDelta: handlers.onDelta,
    onReasoning: handlers.onReasoning,
    onDone: (err) => resolveDone(err),
  }
  waiters.set(session.id, waiter)
  let timerID
  const timer = new Promise((resolve) => {
    timerID = setTimeout(() => resolve(new Error("timed out")), TIMEOUT_MS)
  })

  try {
    await client.session.prompt({ sessionID: session.id, text })
    const err = await Promise.race([done, timer])
    if (err) {
      const e = errorBody(err)
      const failure = new Error(e.body.error.message)
      failure.status = e.status
      failure.type = e.type
      throw failure
    }
    return {
      sessionID: session.id,
      model: `${modelLabel(providerID, modelID)}${variant ? `#${variant}` : ""}`,
    }
  } finally {
    clearTimeout(timerID)
    waiters.delete(session.id)
    if (!KEEP_SESSIONS) {
      client.session.remove({ sessionID: session.id }).catch(() => {})
    }
  }
}

function sseChunk(id, created, model, delta, finish = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

async function handleChat(req) {
  let body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, { status: 400 })
  }

  const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, "")}`
  const created = Math.floor(Date.now() / 1000)
  const { providerID, modelID, variant } = resolveRequest(body)
  const model = `${modelLabel(providerID, modelID)}${variant ? `#${variant}` : ""}`
  const wantReasoning = body.include_reasoning !== false

  if (body.stream) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let open = true
        const raw = (text) => {
          if (!open) return
          try {
            controller.enqueue(encoder.encode(text))
          } catch {
            open = false
          }
        }
        const send = (obj) => raw(`data: ${JSON.stringify(obj)}\n\n`)
        send(sseChunk(id, created, model, { role: "assistant", content: "" }))
        try {
          await runPrompt(body, {
            onDelta: (delta) => send(sseChunk(id, created, model, { content: delta })),
            onReasoning: (delta) => {
              if (!wantReasoning) return
              send(sseChunk(id, created, model, { reasoning_content: delta, reasoning: delta }))
            },
          })
          send(sseChunk(id, created, model, {}, "stop"))
        } catch (err) {
          const e = errorBody(err)
          send({ error: e.body.error })
        } finally {
          raw("data: [DONE]\n\n")
          open = false
          try {
            controller.close()
          } catch {}
        }
      },
    })
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  const chunks = []
  const thoughts = []
  try {
    await runPrompt(body, {
      onDelta: (delta) => chunks.push(delta),
      onReasoning: (delta) => thoughts.push(delta),
    })
  } catch (err) {
    const e = errorBody(err)
    return Response.json(e.body, { status: e.status, headers: { "Access-Control-Allow-Origin": "*" } })
  }
  const message = { role: "assistant", content: chunks.join("") }
  if (wantReasoning && thoughts.length) {
    message.reasoning_content = thoughts.join("")
    message.reasoning = thoughts.join("")
  }
  return Response.json(
    {
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  )
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, "")

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        },
      })
    }

    if (path === "/health") {
      return Response.json({
        ok: true,
        service: endpoint.url,
        model: DEFAULT_MODEL,
        models: catalog.length,
        catalogUpdated: catalogUpdated ? new Date(catalogUpdated).toISOString() : null,
        workdir: WORKDIR,
      })
    }

    if (path === "/v1/models.md" || path === "/models.md") {
      return new Response(buildModelsMarkdown(), {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      })
    }

    if (path === "/v1/models.json" || path === "/models.json") {
      return Response.json(buildModelsJson(), { headers: { "Access-Control-Allow-Origin": "*" } })
    }

    if ((path === "/v1/models/refresh" || path === "/models/refresh") && req.method === "POST") {
      try {
        const count = await refreshCatalog()
        return Response.json({ ok: true, count, updatedAt: new Date(catalogUpdated).toISOString() })
      } catch (err) {
        return Response.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
      }
    }

    if (path === "/v1/models" || path === "/models") {
      const seen = new Set()
      const data = []
      for (const m of catalog) {
        const mid = `${m.providerID}/${m.modelID}`
        if (seen.has(mid)) continue
        seen.add(mid)
        const efforts = (m.variants ?? []).map((v) => v.id)
        data.push({
          id: mid,
          object: "model",
          created: 0,
          owned_by: m.providerID,
          name: m.name,
          metadata: efforts.length ? { reasoning_efforts: efforts } : undefined,
        })
        // Expose effort variants as pickable model IDs for opencode models.
        if (m.providerID === "opencode") {
          for (const v of m.variants ?? []) {
            const vid = `${mid}#${v.id}`
            if (seen.has(vid)) continue
            seen.add(vid)
            data.push({
              id: vid,
              object: "model",
              created: 0,
              owned_by: m.providerID,
              name: `${m.name} (${v.id})`,
              parent: mid,
            })
          }
        }
      }
      return Response.json({ object: "list", data }, { headers: { "Access-Control-Allow-Origin": "*" } })
    }

    if ((path === "/v1/chat/completions" || path === "/chat/completions") && req.method === "POST") {
      return handleChat(req)
    }

    return Response.json({ error: { message: `No route for ${req.method} ${path}`, type: "invalid_request_error" } }, { status: 404 })
  },
})

console.log(`opencode bridge listening on http://${HOST}:${PORT}`)
console.log(`  opencode service: ${endpoint.url}`)
console.log(`  workdir:          ${WORKDIR}`)
console.log(`  default model:    ${DEFAULT_MODEL}`)
console.log(`  models in catalog: ${catalog.length}`)
console.log(`  models file:      ${MODELS_DIR}/models.md`)
console.log(`  refresh interval: ${Math.round(REFRESH_MS / 60000)} min`)
