import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTestFile } from "../src/qa-loader.js";
import { runSuite } from "../src/runner.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const interactiveServer = `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer({ name: "interactive", version: "1.0.0" });
server.registerTool("confirm_delete", {}, async () => {
  const answer = await server.server.elicitInput({ message: "Really delete?", requestedSchema: { type: "object", properties: { confirm: { type: "boolean" } } } });
  return { content: [{ type: "text", text: "done" }], structuredContent: { action: answer.action, confirmed: answer.content?.confirm ?? false } };
});
server.registerTool("summarize", {}, async () => {
  const msg = await server.server.createMessage({ messages: [{ role: "user", content: { type: "text", text: "summarize" } }], maxTokens: 50 });
  return { content: [{ type: "text", text: "ok" }], structuredContent: { summary: msg.content.text } };
});
await server.connect(new StdioServerTransport());
`;

async function fixture(suiteText: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "rigor-elicit-"));
  roots.push(root);
  await writeFile(join(root, "server.mjs"), interactiveServer);
  await writeFile(join(root, "suite.mcpr"), suiteText);
  await symlink(join(process.cwd(), "node_modules"), join(root, "node_modules"), "junction").catch(() => {});
  return root;
}

describe("scripted elicitation and sampling", () => {
  it("accept with fields, decline, and scripted sampling all run deterministically", async () => {
    const root = await fixture(`MCP Test 1
Suite: "Interactive"
Server: node server.mjs

Test: "accepts with fields"
  When the server asks for input, respond "accept" with:
    confirm: true
  Call tool "confirm_delete"
  Expect "structuredContent.action" equals "accept"
  Expect "structuredContent.confirmed" equals true

Test: "declines"
  When the server asks for input, respond "decline"
  Call tool "confirm_delete"
  Expect "structuredContent.action" equals "decline"

Test: "sampling scripted"
  When the server requests sampling, respond "A deterministic summary."
  Call tool "summarize"
  Expect "structuredContent.summary" equals "A deterministic summary."
`);
    const suite = await loadTestFile(join(root, "suite.mcpr"));
    const result = await runSuite(suite, { cwd: root });
    expect(result.summary).toMatchObject({ passed: 3, failed: 0 });
  }, 60000);

  it("rejects a with: block on decline", async () => {
    const root = await fixture(`MCP Test 1
Suite: "Bad"
Server: node server.mjs

Test: "invalid"
  When the server asks for input, respond "decline" with:
    confirm: true
  Call tool "confirm_delete"
  Expect "structuredContent.action" equals "decline"
`);
    await expect(loadTestFile(join(root, "suite.mcpr"))).rejects.toThrow(/Only an 'accept' response/);
  }, 30000);
});
