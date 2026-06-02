# Connecting to the Xterio Finance MCP

The finance system exposes a **read-only MCP endpoint** so you can query live
finance data (cash position, journals, payments) from Claude.

- **Server URL:** `https://xter-finance.zeabur.app/mcp`
- **Auth:** a personal bearer token (looks like `xtcfo_…`). The CFO issues one per
  person. Keep it private — it's read-only but exposes finance data, so don't
  paste it into Slack/email/shared chats.

> The web app dashboard (same host) is separate and behind its own login. Your
> bearer token is **only** for `/mcp`.

---

## Option A — Claude Desktop (recommended)

**Prerequisite:** [Node.js](https://nodejs.org) installed (the connector uses `npx`).

1. Open the config file (Claude Desktop → **Settings → Developer → Edit Config**,
   or directly):
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Add this (merge into an existing `mcpServers` block if you have one):

   ```json
   {
     "mcpServers": {
       "xter-finance": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote",
           "https://xter-finance.zeabur.app/mcp",
           "--header", "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"
         ]
       }
     }
   }
   ```
3. Fully quit and reopen Claude Desktop. The `xter-finance` connector (7 tools)
   should appear.

## Option B — Claude Code (CLI)

```bash
claude mcp add --transport http xter-finance https://xter-finance.zeabur.app/mcp \
  --header "Authorization: Bearer PASTE_YOUR_TOKEN_HERE"
```

Verify with `claude mcp list` (should show `xter-finance` connected).

---

## Test it

Ask Claude: **"Using xter-finance, what's the consolidated cash position?"** — it
should call a tool and answer.

## Available tools (all read-only)

| Tool | What it does |
|------|--------------|
| `get_cash_position` | Aggregate cash per company or consolidated |
| `get_cash_history` | Weekly cash trend |
| `get_company` | One company's accounts + latest balances |
| `list_recent_journal_entries` | Journal entries with filters |
| `search_journal_entries` | Substring search over journal entries |
| `get_journal_entry` | Full detail of one journal entry |
| `list_payments` | Money in/out with filters |

## Troubleshooting

- **`claude.ai` website "Custom Connectors" won't work** — those require OAuth,
  which this server doesn't implement. Use **Claude Desktop** or **Claude Code**.
- **401 / unauthorized** — token missing, mistyped, or has stray spaces. Re-check
  the `Authorization: Bearer …` value.
- **Tools don't appear** — confirm Node.js is installed and fully restart the app.
