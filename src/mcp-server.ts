import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { checkContract, contractReport } from "./contract.js";
import { loadTestFile } from "./qa-loader.js";
import { runParity, parityReport } from "./parity.js";
import { runSuite } from "./runner.js";
import { starterTemplate } from "./starter.js";
import type { RunResult } from "./types.js";
import { FRAMEWORK_VERSION } from "./version.js";
import { appendHistory, atomicWrite, limitedRead, readHistory, safePath, suites } from "./workspace.js";

/**
 * MCP server exposing MCP Rigor itself, so AI agents can validate and run
 * natural-language acceptance tests against the MCP servers they are building.
 *
 * Trust model: identical to running the CLI in the same directory. run_tests
 * starts whatever command the suite's Server: line declares, exactly like
 * `mcprigor test`. Point the root at a project you trust.
 */

const MAX_BATCH = 20;
/** Guards against a suite whose Server: line spawns mcprigor serve again. */
const NESTING_ENV = "MCPRIGOR_MCP_DEPTH";
const MAX_NESTING = 2;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "list_suites",
    description:
      "List the natural-language MCP test files (.mcpr, YAML, JSON) available under the workspace root. Returns relative paths usable with the other tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_suite",
    description: "Read the full text of one test file so it can be reviewed or edited.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path from list_suites" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_suite",
    description:
      "Create or overwrite one natural-language test file (.mcpr) inside the workspace root. Use validate_suite afterwards to check the wording. Pass text as the complete file content; omit text to create a starter template.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative .mcpr path, e.g. tests/checkout.mcpr" },
        text: { type: "string", description: "Complete file content; omitted = starter template" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "validate_suite",
    description:
      "Compile a test file without starting any server. Returns { valid, tests, parityTargets } or a diagnostic with the exact line and column plus a fix hint. Deterministic: the same text always yields the same result.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path of the test file" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "run_tests",
    description:
      "Run one or more test files against the MCP server each suite declares (Server: command or MCP URL: endpoint). Returns structured per-test results: status, duration, and failure messages. This starts the server process declared inside each suite, with the workspace root as working directory.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_BATCH,
          description: "Relative paths of test files to run",
        },
        filter: { type: "string", description: "Only run tests whose name matches this substring/pattern (same as CLI --test)" },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
  {
    name: "run_parity",
    description:
      "Run a suite's declared parity targets and compare behavior across transports (for example stdio versus Streamable HTTP). The suite must declare Compare/Parity targets.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Relative path of the suite with parity targets" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "get_contract_drift",
    description:
      "Compare a saved contract lock file against the live server a suite declares. Read-only: reports added, removed, and changed tools/resources/prompts classified as breaking or non-breaking. Never updates the lock file — updating baselines is an explicit human CLI action (mcprigor contract-update).",
    inputSchema: {
      type: "object",
      properties: {
        lock: { type: "string", description: "Relative path of the contract lock file (e.g. mcp.lock.yaml)" },
        suite: { type: "string", description: "Relative path of a suite whose declared server to compare against" },
      },
      required: ["lock", "suite"],
      additionalProperties: false,
    },
  },
  {
    name: "get_history",
    description:
      "Read recorded run history for this workspace: per-run suite status, duration, and per-test outcomes. Useful for spotting regressions and flaky tests. Optional filters by suite path and test name.",
    inputSchema: {
      type: "object",
      properties: {
        suite: { type: "string", description: "Only entries for this suite path" },
        test: { type: "string", description: "Only entries containing this exact test name" },
        limit: { type: "number", description: "Maximum entries, newest last (default 50, max 200)" },
      },
      additionalProperties: false,
    },
  },
];

function text(value: unknown): { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

function failure(message: string): ReturnType<typeof text> {
  return { content: [{ type: "text", text: message }], isError: true };
}

function argument(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  if (typeof value !== "string" || !value.length) throw new Error(`MCP-SRV-400 ${key} must be a non-empty string`);
  return value;
}

export interface McpServeOptions {
  root?: string;
}

export async function startMcpServer(options: McpServeOptions = {}): Promise<void> {
  const depth = Number(process.env[NESTING_ENV] ?? "0");
  if (depth >= MAX_NESTING) throw new Error(`MCP-SRV-508 Refusing to nest mcprigor serve ${depth + 1} levels deep; a suite under test appears to start mcprigor serve itself`);
  const root = await realpath(resolve(options.root ?? process.cwd()));
  const rootInfo = await stat(root).catch(() => undefined);
  if (!rootInfo?.isDirectory()) throw new Error(`MCP-SRV-404 Workspace root is not a directory: ${root}`);
  const historyFile = join(root, ".mcprigor", "workspace-history.jsonl");
  process.env[NESTING_ENV] = String(depth + 1); // inherited by every server a suite spawns

  const server = new Server(
    { name: "mcprigor", version: FRAMEWORK_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments as Record<string, unknown> | undefined;
    try {
      switch (request.params.name) {
        case "list_suites":
          return text({ root, suites: await suites(root) });

        case "read_suite": {
          const path = safePath(root, argument(args, "path"));
          return text({ path: relative(root, path), text: await limitedRead(path) });
        }

        case "write_suite": {
          const input = argument(args, "path");
          if (!input.endsWith(".mcpr")) throw new Error("MCP-SRV-400 write_suite only writes .mcpr files");
          const path = safePath(root, input);
          const body = typeof args?.text === "string" ? args.text : starterTemplate;
          if (body.length > 1024 * 1024) throw new Error("MCP-SRV-413 File exceeds 1 MiB");
          await atomicWrite(path, body);
          return text({ path: relative(root, path), bytes: body.length, written: true });
        }

        case "validate_suite": {
          const path = safePath(root, argument(args, "path"));
          try {
            const suite = await loadTestFile(path);
            return text({ valid: true, suiteName: suite.name, tests: suite.tests.map((item) => item.name), parityTargets: suite.targets ? Object.keys(suite.targets) : [] });
          } catch (error) {
            const span = (error as { span?: { start?: { line?: number; column?: number } } }).span;
            return text({ valid: false, message: error instanceof Error ? error.message : String(error), ...(span?.start?.line ? { line: span.start.line, column: span.start.column ?? 1 } : {}) });
          }
        }

        case "run_tests": {
          const paths = args?.paths;
          if (!Array.isArray(paths) || !paths.length || paths.length > MAX_BATCH || paths.some((item) => typeof item !== "string")) throw new Error(`MCP-SRV-400 paths must be 1-${MAX_BATCH} strings`);
          const items = [];
          for (const item of paths as string[]) {
            const path = safePath(root, item);
            const startedAt = Date.now();
            try {
              const suite = await loadTestFile(path);
              const filter = typeof args?.filter === "string" && args.filter.length ? args.filter : undefined;
              const result: RunResult = await runSuite(suite, { cwd: root, ...(filter ? { filter } : {}) });
              const tests = result.tests.map((entry) => ({ name: entry.name, status: entry.status, durationMs: entry.durationMs, ...(entry.error ? { error: entry.error } : {}) }));
              await appendHistory(historyFile, { at: new Date().toISOString(), mode: "test", suite: relative(root, path), status: result.status, durationMs: Date.now() - startedAt, tests });
              items.push({ suite: relative(root, path), status: result.status, durationMs: Date.now() - startedAt, tests });
            } catch (error) {
              items.push({ suite: relative(root, path), status: "failed" as const, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
            }
          }
          const status = items.some((item) => item.status === "failed") ? "failed" : "passed";
          const response = text({ status, items });
          if (status === "failed") response.isError = true;
          return response;
        }

        case "run_parity": {
          const path = safePath(root, argument(args, "path"));
          const suite = await loadTestFile(path);
          if (!suite.targets) throw new Error("MCP-SRV-422 This suite declares no parity targets; add Compare target sections first");
          const result = await runParity(suite, suite.targets, { cwd: root });
          const response = text({ suite: relative(root, path), status: result.status, report: parityReport(result) });
          if (result.status === "failed") response.isError = true;
          return response;
        }

        case "get_contract_drift": {
          const lockPath = safePath(root, argument(args, "lock"));
          const suitePath = safePath(root, argument(args, "suite"));
          const suite = await loadTestFile(suitePath);
          const driftTarget = suite.target.transport === "stdio" && !suite.target.cwd ? { ...suite.target, cwd: root } : suite.target;
          const checked = await checkContract(lockPath, driftTarget);
          const response = text({ lock: relative(root, lockPath), breaking: Boolean(checked.diff.breaking), report: contractReport(checked.diff) });
          if (checked.diff.breaking) response.isError = true;
          return response;
        }

        case "get_history": {
          const limitRaw = typeof args?.limit === "number" ? args.limit : 50;
          const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)));
          const suiteFilter = typeof args?.suite === "string" ? args.suite : undefined;
          const testFilter = typeof args?.test === "string" ? args.test : undefined;
          const entries = (await readHistory(historyFile))
            .filter((entry) => (!suiteFilter || entry.suite === suiteFilter) && (!testFilter || entry.tests.some((item) => item.name === testFilter)))
            .slice(-limit);
          return text({ entries });
        }

        default:
          return failure(`MCP-SRV-404 Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
