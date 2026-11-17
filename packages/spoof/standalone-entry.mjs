// Single-file build entry: embeds the version-matched prompts so the compiled
// exe runs on its own (no repo files, no Bun install).
//
//   bun build packages/spoof/standalone-entry.mjs --compile --outfile dist/opencode-spoof.exe
import prompts from "./agent-prompts.json"

process.env.OPENCODE_PROMPTS_B64 = Buffer.from(JSON.stringify(prompts), "utf8").toString("base64")
await import("./spoof.mjs")
