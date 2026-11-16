# Setup for non-nerds

This is the shortest path from zero to "my app is using opencode's models". No terminal knowledge required beyond double-clicking one file.

## What you need

1. **opencode installed and signed in** — download from [opencode.ai](https://opencode.ai), open it once, sign in with OpenCode Console, and send one message in the chat. (You need this because the proxy borrows *your* login and one of *your* session IDs. It cannot work with someone else's.)
2. **Bun** — a runtime. Install it once by opening a terminal and typing `npm install -g bun`. If you don't have `npm`, install [Node.js](https://nodejs.org) first (click Next a few times).
3. **This repo** — download it (green "Code" button → Download ZIP) and unzip it anywhere. Don't unzip it inside a system folder.

## Windows: two clicks

1. Double-click **`setup.cmd`**.
2. It checks everything and then prints:

   ```
   ============================================
     Setting:  Base URL  http://127.0.0.1:8788/v1
               API key   anything
               Model     glm-5.3-flash-free
     Keep this window open while you use it.
   ============================================
   ```

3. **Leave that window open.** That window *is* the server. Closing it turns the models off.

If it says something is missing (✗), it tells you exactly what to do — sign in to opencode, install Bun, or send one opencode message. Fix that one thing and double-click again.

## macOS / Linux

Open Terminal in the folder and run:

```sh
chmod +x setup.sh
./setup.sh
```

## Connect your app

Every app that supports "OpenAI compatible" or "custom OpenAI endpoint" needs the same three values:

| Setting | Value |
| --- | --- |
| Base URL / Endpoint | `http://127.0.0.1:8788/v1` |
| API key | anything — type `opencode` |
| Model | `glm-5.3-flash-free` |

Where to paste them in common apps:

- **ZCode** — Settings → Models/Providers → Add provider → type "OpenAI compatible" → paste the three values above. Save, then pick the model in the chat.
- **Open WebUI** — Admin Settings → Connections → Add OpenAI connection → URL `http://127.0.0.1:8788/v1`, key `opencode`, then the model appears in the model picker.
- **Chatbox / LM Studio / Jan / SillyTavern** — Model settings → OpenAI API compatible → same three values.
- **Python** — `OpenAI(base_url="http://127.0.0.1:8788/v1", api_key="opencode")`
- **Node** — same with the `openai` package.

## How to know it works

With the setup window open, open a second terminal in the folder and run:

```sh
bun test-spoof.mjs
```

If the last line says `✓ proxy works`, everything is wired. Then ask your app a question.

## Problems, in order of likelihood

| What you see | What it means |
| --- | --- |
| "Bun is not installed" | Run `npm install -g bun` (install Node.js first if needed). |
| "not signed in to OpenCode Console" | Open opencode, sign in, send one message, then double-click `setup.cmd` again. |
| "no opencode sessions found" | Same fix: send one message in opencode first. |
| Your app says `FreeUsageLimitError`, but opencode itself still works | The request didn't look like opencode to the server. Restart the proxy; if it persists, opencode probably changed something — see [HOW-IT-WORKS.md](HOW-IT-WORKS.md) §10. |
| `FreeUsageLimitError` **and** opencode itself is also blocked | You used up the free quota for your network. Wait, or use another network. Not a bug. |
| Your app refuses `http://127.0.0.1` | Some apps insist on `https` or a public host. Try a different app, or put a local TLS proxy in front. |
| The setup window closed | The server stopped. Double-click `setup.cmd` again. |
| Port 8788 already in use | Another copy is already running — use it, or set `OPENCODE_SPOOF_PORT=8789`. |

## Two things people ask

**"Will this work for my friend if they download it?"** Yes — the code contains no credentials. Their copy uses **their** opencode login and **their** quota. They need the same three things you needed.

**"Will it keep working after opencode updates?"** Maybe. The proxy checks at startup whether your installed opencode ships a different prompt and warns you if it does (`prompt drift: DETECTED`). When that happens the request rules need refreshing once — the recipe is in [HOW-IT-WORKS.md](HOW-IT-WORKS.md) §2 and §10. This is also why the repo ships its research notes rather than just a binary: so it can be fixed without starting from zero.
