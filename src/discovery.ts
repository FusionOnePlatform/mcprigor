import { writeFile } from "node:fs/promises";
import YAML from "yaml";
import { canonicalize, fingerprint } from "./canonical.js";
import { createSession } from "./session.js";
import type { DiscoveryDocument, Suite, Target } from "./types.js";

const SURFACES = [
  ["tools", "tools/list"],
  ["resources", "resources/list"],
  ["resourceTemplates", "resources/templates/list"],
  ["prompts", "prompts/list"],
] as const;

export async function discoverTarget(target: Target): Promise<DiscoveryDocument> {
  const session = createSession(target);
  try {
    const info = await session.connect();
    const surfaces: Record<string, unknown[]> = {};
    for (const [key, method] of SURFACES) {
      surfaces[key] = capabilityPresent(info.capabilities, method) ? await listAll(session, method, key) : [];
    }
    const contract = canonicalize({ server: { name: info.serverName, version: info.serverVersion, capabilities: info.capabilities }, protocolVersion: info.protocolVersion, ...surfaces });
    return {
      schemaVersion: 1,
      discoveredAt: new Date().toISOString(),
      target: { transport: target.transport },
      server: { name: info.serverName, version: info.serverVersion, capabilities: canonicalize(info.capabilities) },
      protocolVersion: info.protocolVersion,
      tools: surfaces.tools ?? [], resources: surfaces.resources ?? [], resourceTemplates: surfaces.resourceTemplates ?? [], prompts: surfaces.prompts ?? [],
      fingerprint: fingerprint(contract), diagnostics: session.diagnostics(),
    };
  } finally { await session.close(); }
}

export async function writeLock(document: DiscoveryDocument, file: string): Promise<void> {
  await writeFile(file, YAML.stringify(document, { sortMapEntries: true }), "utf8");
}

export function generateSuite(lock: DiscoveryDocument, target: Target): Suite {
  const tests: Suite["tests"] = [];
  if (lock.tools.length) tests.push({
    name: "contract: tools remain discoverable", requires: { capabilities: ["tools"] },
    steps: [{ request: { method: "tools/list" }, assert: { json: (lock.tools as Array<{ name?: string }>).filter((x) => x.name).map((tool) => ({ path: "$.tools", contains: { name: tool.name } })) } }],
  });
  if (lock.resources.length) tests.push({
    name: "contract: resources remain discoverable", requires: { capabilities: ["resources"] },
    steps: [{ request: { method: "resources/list" }, assert: { json: (lock.resources as Array<{ uri?: string }>).filter((x) => x.uri).map((resource) => ({ path: "$.resources", contains: { uri: resource.uri } })) } }],
  });
  if (lock.prompts.length) tests.push({
    name: "contract: prompts remain discoverable", requires: { capabilities: ["prompts"] },
    steps: [{ request: { method: "prompts/list" }, assert: { json: (lock.prompts as Array<{ name?: string }>).filter((x) => x.name).map((prompt) => ({ path: "$.prompts", contains: { name: prompt.name } })) } }],
  });
  if (!tests.length) tests.push({ name: "server responds to ping", steps: [{ request: { method: "ping" }, assert: { status: "success" } }] });
  return { version: 1, name: `Generated contract smoke tests for ${lock.server.name ?? "MCP server"}`, target, tests };
}

export async function writeGeneratedSuite(suite: Suite, file: string): Promise<void> {
  await writeFile(file, YAML.stringify(suite), "utf8");
}

async function listAll(session: ReturnType<typeof createSession>, method: string, field: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor: string | undefined;
  do {
    const result = await session.request(method, cursor ? { cursor } : undefined) as Record<string, unknown>;
    const page = result[field];
    if (Array.isArray(page)) items.push(...page);
    cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
  } while (cursor);
  return canonicalize(items) as unknown[];
}

function capabilityPresent(capabilities: Record<string, unknown> | undefined, method: string): boolean {
  if (method.startsWith("tools/")) return !!capabilities?.tools;
  if (method.startsWith("prompts/")) return !!capabilities?.prompts;
  if (method.startsWith("resources/")) return !!capabilities?.resources;
  return true;
}
