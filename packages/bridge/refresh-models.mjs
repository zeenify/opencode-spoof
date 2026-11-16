#!/usr/bin/env bun
/**
 * Standalone model-catalog refresh: builds models.md / models.json from the
 * local opencode service without needing the bridge server to be running.
 *
 *   bun packages/bridge/refresh-models.mjs
 */
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { join } from "node:path"

const OUT_DIR = process.env.OPENCODE_BRIDGE_MODELS_DIR ?? process.cwd()
const BASE_URL = `http://${process.env.OPENCODE_BRIDGE_HOST ?? "127.0.0.1"}:${process.env.OPENCODE_BRIDGE_PORT ?? 8787}/v1`
const DEFAULT_MODEL = process.env.OPENCODE_BRIDGE_MODEL ?? "opencode/glm-5.3-flash-free"

const endpoint = await Service.ensure()
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })

function isFreeModel(m) {
  const tiers = m.cost ?? []
  if (tiers.length === 0) return false
  return tiers.every((c) => (c.input ?? 0) === 0 && (c.output ?? 0) === 0)
}
const human = (n) => {
  if (n == null) return "-"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}
const costLabel = (m) => {
  const tiers = m.cost ?? []
  if (tiers.length === 0) return "-"
  const c = tiers[0]
  const input = c.input ?? 0
  const output = c.output ?? 0
  return input === 0 && output === 0 ? "free" : `$${input} / $${output}`
}
const modelId = (m) => `${m.providerID}/${m.modelID}`

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

const out = await client.model.list()
const catalog = (out.data ?? []).filter((m) => m.type === "chat" && m.enabled !== false)
if (catalog.length === 0) {
  console.error("No models returned — is opencode installed and signed in?")
  process.exit(1)
}

const free = catalog.filter((m) => m.providerID === "opencode" && isFreeModel(m))
const paid = catalog.filter((m) => m.providerID === "opencode" && !isFreeModel(m))
const others = catalog.filter((m) => m.providerID !== "opencode")
const byProvider = new Map()
for (const m of others) {
  if (!byProvider.has(m.providerID)) byProvider.set(m.providerID, [])
  byProvider.get(m.providerID).push(m)
}

const lines = [
  "# opencode models",
  "",
  `Generated: ${new Date().toLocaleString()}`,
  `Base URL: ${BASE_URL}`,
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
  paid.length ? tableFor(paid) : "_None_",
  "",
  "## Other providers",
  "",
]
for (const [provider, models] of [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`### ${provider}`, "", tableFor(models), "")
}

const json = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
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

await Bun.write(join(OUT_DIR, "models.md"), lines.join("\n"))
await Bun.write(join(OUT_DIR, "models.json"), JSON.stringify(json, null, 2) + "\n")
console.log(`catalog: ${catalog.length} chat models (${free.length} free) -> ${join(OUT_DIR, "models.md")}`)
process.exit(0)
