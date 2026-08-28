#!/usr/bin/env node
// stdio bridge to the hosted llmaudit MCP server.
//
// The measurement runs on mcp.llmaudit.app (it needs the provider keys, which
// never leave the server). This package exists for MCP clients that can only
// launch a local command, like the Claude Desktop config file: it speaks stdio
// on this side and streamable HTTP on the other, through mcp-remote.
//
// Extra arguments are passed through to mcp-remote (for example --transport
// http-only or --debug). LLMAUDIT_MCP_URL overrides the endpoint, for staging.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const proxy = require.resolve("mcp-remote/dist/proxy.js");
const url = process.env.LLMAUDIT_MCP_URL || "https://mcp.llmaudit.app/mcp";
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    [
      "llmaudit-mcp: stdio bridge to https://mcp.llmaudit.app/mcp",
      "",
      "Usage in an MCP client config:",
      '  {"mcpServers":{"llmaudit":{"command":"npx","args":["-y","llmaudit-mcp"]}}}',
      "",
      "Clients that accept a URL directly do not need this package:",
      '  {"mcpServers":{"llmaudit":{"url":"https://mcp.llmaudit.app/mcp"}}}',
      "",
      "Tools: start_visibility_check, get_visibility_check. Resource: llmaudit://methodology.",
      "Free, no signup, one measurement per domain every 30 days. https://llmaudit.app/developers",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const child = spawn(process.execPath, [proxy, url, ...args], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
