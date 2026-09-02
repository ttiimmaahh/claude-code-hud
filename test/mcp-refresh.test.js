const { test } = require("node:test");
const assert = require("node:assert/strict");

const { countRemoteMcpLines } = require("../dist/mcp-refresh.js");

// Shape of real `claude mcp list` output. Note the status icon is U+2714 "✔",
// NOT U+2713 "✓" — an earlier regex used the latter and silently counted only
// the "Needs authentication" servers.
const SAMPLE = [
  "Checking MCP server health…",
  "",
  "claude.ai Linear: https://mcp.linear.app/mcp - ! Needs authentication",
  "claude.ai Context7: https://mcp.context7.com/mcp - ✔ Connected",
  "claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected",
  "plugin:context7:context7: npx -y @upstash/context7-mcp - ✔ Connected",
  "some-user-server: node /path/to/server.js - ✔ Connected",
].join("\n");

test("counts every claude.ai server regardless of status", () => {
  assert.equal(countRemoteMcpLines(SAMPLE), 3);
});

test("connected servers using ✔ (U+2714) are counted", () => {
  // The regression that motivated matching on structure instead of the icon.
  const line = "claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected";
  assert.equal(countRemoteMcpLines(line), 1);
});

test("the older ✓ (U+2713) icon is still counted", () => {
  const line = "claude.ai Notion: https://mcp.notion.com/mcp - ✓ Connected";
  assert.equal(countRemoteMcpLines(line), 1);
});

test("servers needing authentication still count as configured", () => {
  const line = "claude.ai Linear: https://mcp.linear.app/mcp - ! Needs authentication";
  assert.equal(countRemoteMcpLines(line), 1);
});

test("plugin and user servers are excluded to avoid double-counting", () => {
  // env.ts already counts these from disk.
  const lines = [
    "plugin:context7:context7: npx -y @upstash/context7-mcp - ✔ Connected",
    "some-user-server: node /path/to/server.js - ✔ Connected",
  ].join("\n");
  assert.equal(countRemoteMcpLines(lines), 0);
});

test("CRLF line endings are handled", () => {
  // The refresher now runs on Windows, where the CLI emits \r\n. Splitting on
  // \n alone would leave a trailing \r — harmless here, but the split must not
  // merge or drop lines.
  const crlf = SAMPLE.replace(/\n/g, "\r\n");
  assert.equal(countRemoteMcpLines(crlf), 3);
});

test("headers, blank lines and noise are ignored", () => {
  assert.equal(countRemoteMcpLines("Checking MCP server health…\n\n\n"), 0);
});

test("a claude.ai line without a status is not counted", () => {
  // Guards against matching a truncated or wrapped line.
  assert.equal(countRemoteMcpLines("claude.ai Notion: https://mcp.notion.com/mcp"), 0);
  assert.equal(countRemoteMcpLines("claude.ai Notion: https://mcp.notion.com/mcp - "), 0);
});

test("empty and missing output count as zero", () => {
  assert.equal(countRemoteMcpLines(""), 0);
  assert.equal(countRemoteMcpLines(undefined), 0);
  assert.equal(countRemoteMcpLines(null), 0);
});
