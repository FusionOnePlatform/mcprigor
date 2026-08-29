import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import type { Target } from "./types.js";

export interface ProjectConfig {
  /** Directory containing the config file; relative paths resolve against it. */
  root: string;
  defaultEnvironment?: string;
  environments: Record<string, Target>;
}

const FILE_NAMES = ["mcprigor.config.yaml", "mcprigor.config.yml"];

/** Find mcprigor.config.yaml in startDir or any parent directory. */
export async function findProjectConfig(startDir: string): Promise<ProjectConfig | undefined> {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of FILE_NAMES) {
      try {
        const source = await readFile(join(dir, name), "utf8");
        return parseProjectConfig(source, dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function parseProjectConfig(source: string, root: string): ProjectConfig {
  const raw = YAML.parse(source) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("MCP-PROJ-001 mcprigor.config.yaml must contain a mapping");
  const environmentsRaw = raw.environments;
  if (!environmentsRaw || typeof environmentsRaw !== "object" || Array.isArray(environmentsRaw)) throw new Error("MCP-PROJ-002 mcprigor.config.yaml needs an 'environments' mapping (name -> server/url)");
  const environments: Record<string, Target> = {};
  for (const [name, value] of Object.entries(environmentsRaw as Record<string, unknown>)) {
    environments[name] = parseEnvironmentTarget(name, value);
  }
  const defaultEnvironment = typeof raw.default === "string" ? raw.default : undefined;
  if (defaultEnvironment && !environments[defaultEnvironment]) throw new Error(`MCP-PROJ-004 default environment "${defaultEnvironment}" is not defined under environments`);
  return { root, defaultEnvironment, environments };
}

function parseEnvironmentTarget(name: string, value: unknown): Target {
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value)
      ? { transport: "streamable-http", url: value }
      : commandTarget(name, value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string") {
      const target: Target = { transport: "streamable-http", url: record.url };
      if (record.headers && typeof record.headers === "object") target.headers = record.headers as Record<string, string>;
      if (typeof record["token from"] === "string") target.tokenFrom = (record["token from"] as string).trim();
      if (typeof record.tokenFrom === "string") target.tokenFrom = (record.tokenFrom as string).trim();
      return target;
    }
    if (typeof record.server === "string" || typeof record.command === "string") {
      const target = commandTarget(name, (record.server ?? record.command) as string);
      if (typeof record.cwd === "string") target.cwd = record.cwd;
      if (record.env && typeof record.env === "object") target.env = record.env as Record<string, string>;
      return target;
    }
  }
  throw new Error(`MCP-PROJ-003 Environment "${name}" must be a command string, a URL, or a mapping with server/url`);
}

function commandTarget(name: string, command: string): Extract<Target, { transport: "stdio" }> {
  const [head, ...rest] = command.split(/\s+/).filter(Boolean);
  if (!head) throw new Error(`MCP-PROJ-003 Environment "${name}" has an empty command`);
  return { transport: "stdio", command: head, args: rest };
}

/** Pick the target for --env (or the config default). Returns undefined when nothing applies. */
export function environmentTarget(config: ProjectConfig | undefined, requested?: string): { name: string; target: Target } | undefined {
  if (!config) {
    if (requested) throw new Error(`MCP-PROJ-005 --env ${requested} was given but no mcprigor.config.yaml was found in this directory or any parent`);
    return undefined;
  }
  const name = requested ?? config.defaultEnvironment;
  if (!name) return undefined;
  const target = config.environments[name];
  if (!target) throw new Error(`MCP-PROJ-006 Environment "${name}" is not defined in mcprigor.config.yaml (known: ${Object.keys(config.environments).join(", ")})`);
  return { name, target: structuredClone(target) };
}
