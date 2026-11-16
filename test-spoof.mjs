/**
 * Exercise the spoof proxy the way a real harness does:
 * OpenAI SDK + a tool definition + streaming.
 *
 *   bun test-spoof.mjs            one attempt
 *   bun test-spoof.mjs --wait     retry every 5 min until the free bucket refills
 */

import OpenAI from "openai"

const BASE = process.env.OPENCODE_SPOOF_URL ?? "http://127.0.0.1:8788/v1"
const MODEL = process.env.OPENCODE_SPOOF_MODEL ?? "glm-5.3-flash-free"
const wait = process.argv.includes("--wait")

const client = new OpenAI({ baseURL: BASE, apiKey: "opencode" })

const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
]

async function attempt() {
  console.log(`\n→ ${MODEL} @ ${BASE}`)
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "You are a terse assistant. Use tools when asked." },
      { role: "user", content: "What's the weather in Paris? Use the tool." },
    ],
    tools,
    stream: true,
    stream_options: { include_usage: true },
  })

  let text = ""
  let reasoning = ""
  const calls = []
  let usage = null

  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta
    if (d?.content) {
      text += d.content
      process.stdout.write(d.content)
    }
    if (d?.reasoning_content) reasoning += d.reasoning_content
    for (const tc of d?.tool_calls ?? []) {
      const slot = (calls[tc.index ?? 0] ??= { name: "", args: "" })
      if (tc.function?.name) slot.name = tc.function.name
      if (tc.function?.arguments) slot.args += tc.function.arguments
    }
    if (chunk.usage) usage = chunk.usage
  }

  console.log("\n")
  console.log("text        :", JSON.stringify(text))
  console.log("reasoning   :", reasoning ? JSON.stringify(reasoning.slice(0, 200)) + (reasoning.length > 200 ? "…" : "") : "(none)")
  console.log("tool_calls  :", calls.filter(Boolean).length ? JSON.stringify(calls.filter(Boolean)) : "(none)")
  console.log("usage       :", usage ? JSON.stringify(usage) : "(none)")

  if (!text && !calls.filter(Boolean).length) {
    console.log("\n✗ empty response")
    process.exitCode = 1
    return false
  }
  console.log("\n✓ proxy works — text and/or native tool calls came back")
  return true
}

for (;;) {
  try {
    if (await attempt()) break
    if (!wait) break
  } catch (err) {
    const status = err?.status
    const msg = err?.error?.error?.message ?? err?.message ?? String(err)
    const retryAfter = err?.headers?.get?.("retry-after") ?? err?.headers?.["retry-after"]

    if (status === 429) {
      const secs = Number(retryAfter)
      const mins = Number.isFinite(secs) ? Math.ceil(secs / 60) : null
      console.log(`\n⚠ 429 free usage limit${mins ? ` — resets in ~${mins} min` : ""}`)
      if (!wait) {
        console.log("  run with --wait to retry automatically, or try after the bucket resets")
        break
      }
      const sleep = Number.isFinite(secs) ? Math.min(secs * 1000, 5 * 60 * 1000) : 5 * 60 * 1000
      console.log(`  sleeping ${Math.round(sleep / 1000)}s…`)
      await new Promise((r) => setTimeout(r, sleep))
      continue
    }

    console.log(`\n✗ HTTP ${status ?? "?"}: ${msg}`)
    if (status === 401 || status === 403) console.log("  credential problem — is opencode still signed in?")
    process.exitCode = 1
    break
  }
}
