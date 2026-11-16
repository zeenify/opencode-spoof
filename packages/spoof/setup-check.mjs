#!/usr/bin/env bun
/**
 * Preflight checks for opencode-spoof.
 * Run automatically by setup.cmd / setup.sh, or on its own: bun setup-check.mjs
 */
import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

let failed = false
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => {
  failed = true
  console.log(`  ✗ ${m}`)
}
const warn = (m) => console.log(`  ! ${m}`)

function detectOpencodeVersion() {
  const pkgCandidates = [
    join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm", "node_modules", "@opencode", "cli", "package.json"),
    join(homedir(), ".npm-global", "lib", "node_modules", "@opencode", "cli", "package.json"),
    "/usr/local/lib/node_modules/@opencode/cli/package.json",
    "/usr/lib/node_modules/@opencode/cli/package.json",
    "/opt/homebrew/lib/node_modules/@opencode/cli/package.json",
    join(homedir(), ".bun", "install", "global", "node_modules", "@opencode", "cli", "package.json"),
  ]
  for (const p of pkgCandidates) {
    try {
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).version ?? null
    } catch {}
  }
  try {
    const r = Bun.spawnSync(["opencode", "--version"], { stdout: "pipe", stderr: "ignore" })
    const v = r.stdout.toString().trim().split(/\s+/).pop()
    if (/^\d+\.\d+\.\d+/.test(v)) return v
  } catch {}
  return null
}

function resolveDbPath() {
  const candidates = [
    process.env.OPENCODE_DB,
    process.env.OPENCODE_DATA ? join(process.env.OPENCODE_DATA, "opencode.db") : null,
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "opencode", "opencode.db") : null,
    join(homedir(), ".local", "share", "opencode", "opencode.db"),
    join(homedir(), "Library", "Application Support", "opencode", "opencode.db"),
    process.env.APPDATA ? join(process.env.APPDATA, "opencode", "opencode.db") : null,
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

console.log("\nopencode-spoof setup check\n")

// 1. Bun
ok(`Bun ${Bun.version}`)

// 2. opencode version
const installedVersion = detectOpencodeVersion()
if (installedVersion) ok(`opencode ${installedVersion} detected`)
else warn("could not detect the opencode version")

// 3. opencode database
const DB_PATH = resolveDbPath()
let db
if (!existsSync(DB_PATH)) {
  bad(`opencode database not found (looked in ${DB_PATH})`)
  console.log("      → install opencode and run it once: https://opencode.ai")
} else {
  ok("opencode database found")
  try {
    db = new Database(DB_PATH)
    const row = db
      .query(`select value from credential where active = 1 and value like '%"type":"oauth"%' order by time_updated desc limit 1`)
      .get()
    if (!row) {
      bad("not signed in to OpenCode Console")
      console.log("      → run: opencode auth login   (choose OpenCode Console)")
    } else {
      const c = JSON.parse(row.value)
      ok(`signed in as ${c.metadata?.email ?? "unknown"}${c.metadata?.orgName ? " / " + c.metadata.orgName : ""}`)
    }
  } catch (err) {
    bad(`could not read credentials: ${err.message}`)
  }
}

// 4. recent session (the gate requires one)
if (db) {
  let row = null
  for (const t of ["session_v2", "session"]) {
    try {
      row = db.query(`select id, time_created from ${t} order by time_created desc limit 1`).get()
      if (row) break
    } catch {}
  }
  if (!row) {
    bad("no opencode sessions found")
    console.log("      → open opencode and send one message, then run this again")
  } else {
    const ageH = (Date.now() - Number(row.time_created)) / 3600000
    if (ageH > 12) warn(`newest opencode session is ${ageH.toFixed(0)}h old — open opencode once before using the proxy`)
    else ok(`newest opencode session is ${ageH < 1 ? Math.round(ageH * 60) + " min" : ageH.toFixed(1) + "h"} old`)
  }
}

// 5. prompt file for the installed version
const promptFile =
  process.env.OPENCODE_AGENT_PROMPT_FILE ??
  (existsSync(join(import.meta.dir, "agent-prompts.json")) ? join(import.meta.dir, "agent-prompts.json") : join(import.meta.dir, "agent-prompt.json"))
if (!existsSync(promptFile)) {
  bad(`prompt file missing: ${promptFile}`)
} else {
  try {
    const data = JSON.parse(readFileSync(promptFile, "utf8"))
    if (!data.prompts) ok(`prompt file: single-version (${data.opencodeVersion ?? "unknown"})`)
    else if (installedVersion && data.prompts[installedVersion]) ok(`prompt available for opencode ${installedVersion}`)
    else {
      warn(`no prompt captured for opencode ${installedVersion ?? "?"} — will use default ${data.default}`)
      console.log("      → if requests fail with FreeUsageLimitError, refresh the prompt (docs/HOW-IT-WORKS.md §2)")
    }
  } catch (err) {
    bad(`could not read prompt file: ${err.message}`)
  }
}

console.log("")
if (failed) {
  console.log("Fix the ✗ items above, then run setup again.\n")
  process.exit(1)
}
console.log("All good. Starting the proxy…\n")
