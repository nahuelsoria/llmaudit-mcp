# llmaudit-mcp

MCP server for [llmaudit.app](https://llmaudit.app). Ask your assistant whether a brand actually shows up when buyers ask AI for a recommendation, and get the measured answer: which buyer questions the brand won, which competitors were named instead, and which providers answered.

Free, no signup, no API key. One measurement per domain every 30 days.

## Install

Most clients accept the hosted endpoint directly. Use that when you can:

```json
{"mcpServers":{"llmaudit":{"url":"https://mcp.llmaudit.app/mcp"}}}
```

Claude Code:

```sh
claude mcp add --transport http llmaudit https://mcp.llmaudit.app/mcp
```

For clients that only launch a local command (the Claude Desktop config file, for example), this package bridges stdio to the same server:

```json
{"mcpServers":{"llmaudit":{"command":"npx","args":["-y","llmaudit-mcp"]}}}
```

Requires Node 18+. Nothing runs locally except the bridge: the measurement happens on the server, which holds the provider keys.

## What it exposes

- `start_visibility_check`: starts a measurement for a brand (name, website, category, optional competitors, location and language) and returns a `runId`. Takes about a minute, because the buyer questions are asked live to OpenAI, Anthropic and Gemini.
- `get_visibility_check`: collects the result with the `runId`. Returns `running` until the providers answer, then a verdict in three bands and the counts.
- `llmaudit://methodology`: how the measurement works.

Try it: "Measure how Acme (acme.com), a project management tool, shows up in AI recommendations against Asana and Monday."

## What it returns, and what it does not

It returns the **measured map**: the buyer questions that were actually asked and who won each answer. It never returns a provider's self report (what a model *believes* about a brand), because in practice that number is the optimistic one and can be off by an order of magnitude. There is no 0 to 100 score either: a verdict in three bands and counts you can check.

There is no `email` field. The tool cannot send a result email to anyone.

## Options

- `LLMAUDIT_MCP_URL`: override the endpoint (staging).
- Any extra argument is passed through to [mcp-remote](https://www.npmjs.com/package/mcp-remote), which does the transport.

## Source

Server code, tests and fixtures: [github.com/nahuelsoria/llmaudit-mcp](https://github.com/nahuelsoria/llmaudit-mcp). Developer docs: [llmaudit.app/developers](https://llmaudit.app/developers).
