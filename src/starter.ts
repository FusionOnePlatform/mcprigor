import { access, writeFile } from "node:fs/promises";

export const starterTemplate = `# MCP Rigor — plain-language acceptance tests
Suite: "My MCP server"

# For a local server:
Server: node dist/server.js

# Or replace the line above with:
# MCP URL: http://localhost:3000/mcp

Test: "The calculator adds two numbers"
  Require: tools

  Call tool "add" with:
    a: 2
    b: 3

  Expect "structuredContent.sum" equals 5
  Save "structuredContent.sum" as "answer"
`;

export async function writeStarter(file: string, force = false): Promise<void> {
  if (!force) {
    try { await access(file); throw new Error(`QA-INIT-001 ${file} already exists. Choose another name or add --force.`); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("QA-INIT-001")) throw error;
    }
  }
  await writeFile(file, starterTemplate, "utf8");
}
