# askedthrice-mcp

MCP server for [askedthrice.com](https://askedthrice.com). Lets anyone's assistant measure whether a brand shows up when buyers ask an AI for a recommendation.

Hosted at `https://mcp.askedthrice.com/mcp` (streamable HTTP). Listed in the [official MCP registry](https://registry.modelcontextprotocol.io) as `com.askedthrice/askedthrice`. The stdio bridge for clients that only launch local commands is the npm package [`askedthrice-mcp`](https://www.npmjs.com/package/askedthrice-mcp), in [`npm/`](npm/).

Full spec: `specs/features/geo-13-mcp-server.md` in the private llm-rank-tracker repo.

## Install

```json
{"mcpServers":{"askedthrice":{"url":"https://mcp.askedthrice.com/mcp"}}}
```

or, for command-only clients:

```json
{"mcpServers":{"askedthrice":{"command":"npx","args":["-y","askedthrice-mcp"]}}}
```

## What it exposes

- `start_visibility_check` starts the measurement and returns a `runId`.
- `get_visibility_check` collects it. Returns `running` until the providers answer.
- `askedthrice://methodology` explains how it is measured.

Two tools rather than one because a measurement takes up to two minutes: the audit is 15 to 60 s and the measured map another 15 to 60 s.

## What it returns, and what it does not

It returns the **measured map**: the buyer questions that were asked live and who won each answer. Never the providers' self-report, which is what each model *believes* about the brand. The two numbers drift apart a lot in practice, and the self-report is always the optimistic one; that is why the tool contract does not expose it in any field.

It never returns a 0 to 100 score: a verdict in three bands and counts.

## Money

Every free measurement spends askedthrice's API keys, on the order of USD 0.05 to 0.15. Three guards, all covered by tests:

1. One free measurement per domain every 30 days, checked BEFORE the API is called.
2. `MCP_MONTHLY_RUN_LIMIT` (default 200) as the channel ceiling, separate from the web funnel budget.
3. Rate limiting in prod counts by client identity, not by this server's IP, which rotates on serverless.

## Env

| Variable | Purpose |
| --- | --- |
| `LLMAUDIT_API_BASE_URL` | API base. Default `https://askedthrice.com` |
| `MCP_SERVER_KEY` | Key shared with llm-rank-tracker. Without it prod buckets by IP |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | `mcp_runs` table. Without them the store is in memory and does NOT work on serverless |
| `MCP_MONTHLY_RUN_LIMIT` | Monthly ceiling of runs for the channel |

## Channel usage

`npm run stats` reads `mcp_runs` and reports how much of the monthly ceiling is left, who called, which domains were measured and which one currently holds the 30-day quota.

```sh
node --env-file <file.env> scripts/stats.mjs
node --env-file <file.env> scripts/stats.mjs --days 30 --history 180
```

Needs `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`. `--days` is the daily detail, `--history` how far back it looks; the current month is always included in full, because that number has to match the guard's.

The first thing it prints, when there are any, is the **orphaned** runs: reserved rows that never got their `audit_id`. They return "Unknown runId" to the client forever while holding their domain's free quota and counting against the monthly ceiling. Delete them by `run_id`.

Vercel Web Analytics cannot measure this: it works by injecting a script into HTML, and here there is no HTML and no browser to run it, every request is a JSON-RPC call from an MCP client. It would read zero forever.

## Docker (directory checks)

`Dockerfile` builds the HTTP server and serves it on `0.0.0.0:3001`, which is what Glama and similar directories run to verify the server starts and answers introspection. Port and host are read by `xmcp.config.ts` at build time, so they go as `ENV` before `npm run build`, not at `docker run`. Without `SUPABASE_*` the run store is in memory: fine for a check, not for serving traffic.

## Development

```sh
npm run dev     # xmcp dev
npm test        # vitest, no network
npm run build   # xmcp build
```

Tests run against real fixtures in `fixtures/` (already-paid runs from prospecting). None of them touch the network or call a provider.

## Publishing a new registry version

`server.json` is published with `mcp-publisher` using DNS auth on `askedthrice.com`. The key lives outside the repo as a PEM; the CLI wants the raw ed25519 seed in hex:

```sh
HEX=$(openssl pkey -in <key.pem> -noout -text | sed -n '/^priv:/,/^pub:/p' | grep -v '^priv:\|^pub:' | tr -d ' :\n')
mcp-publisher login dns --domain askedthrice.com --private-key "$HEX"
mcp-publisher publish server.json
```

Bump `version` in `server.json` on every publish; the registry rejects a repeat. When the npm package changes version, update `packages[0].version` too.
