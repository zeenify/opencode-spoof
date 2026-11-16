#!/usr/bin/env bun
/**
 * Preflight checks for opencode-spoof.
 * Run automatically by setup.cmd / setup.sh, or on its own: bun setup-check.mjs
 */
import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync } from "node:fs"

const DB_PATH =
  process.env.OPENCODE_DB ??
  join(process.env.OPENCODE_DATA ?? join(homedir(), ".local", "share", "opencode"), "opencode.db")

let failed = false
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => {
  failed = true
  console.log(`  ✗ ${m}`)
}
const warn = (m) => console.log(`  ! ${m}`)

console.log("\nopencode-spoof setup check\n")

// 1. Bun
ok(`Bun ${Bun.version}`)

// 2. opencode database
if (!existsSync(DB_PATH)) {
  bad(`opencode database not found at ${DB_PATH}`)
  console.log("      → install opencode and run it once: https://opencode.ai")
} else {
  ok(`opencode database found`)
}

// 3. signed in
let db
if (existsSync(DB_PATH)) {
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
    if (ageH > 12) {
      warn(`newest opencode session is ${ageH.toFixed(0)}h old — open opencode once before using the proxy`)
    } else {
      ok(`newest opencode session is ${ageH < 1 ? Math.round(ageH * 60) + " min" : ageH.toFixed(1) + "h"} old`)
    }
  }
}

// 5. prompt file + version drift
const promptFile = process.env.OPENCODE_AGENT_PROMPT_FILE ?? join(import.meta.dir, "agent-prompt.json")
if (!existsSync(promptFile)) {
  bad(`prompt file missing: ${promptFile}`)
} else {
  ok(`prompt file: ${promptFile}`)
  try {
    const shipped = JSON.parse(readFileSync(promptFile, "utf8")).opencodeVersion
    const pkg = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm", "node_modules", "@opencode", "cli", "package.json")
    if (shipped && existsSync(pkg)) {
      const installed = JSON.parse(readFileSync(pkg, "utf8")).version
      if (installed && installed !== shipped) {
        warn(`prompt was captured from opencode ${shipped}, but ${installed} is installed`)
        console.log("      → if requests fail with FreeUsageLimitError, refresh the prompt (docs/HOW-IT-WORKS.md §2)")
      } else if (installed) {
        ok(`prompt matches installed opencode ${installed}`)
      }
    }
  } catch {}
}

console.log("")
if (failed) {
  console.log("Fix the ✗ items above, then run setup again.\n")
  process.exit(1)
}
console.log("All good. Starting the proxy…\n")
