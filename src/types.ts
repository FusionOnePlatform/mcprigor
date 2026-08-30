export interface StdioTarget {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface HttpTarget {
  transport: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  /** Command executed before connect; its trimmed stdout becomes the Authorization bearer token. Keeps secrets out of suite files. */
  tokenFrom?: string;
}

export type Target = StdioTarget | HttpTarget;

export interface JsonAssertion {
  path?: string;
  equals?: unknown;
  notEquals?: unknown;
  exists?: boolean;
  type?: "string" | "number" | "boolean" | "object" | "array" | "null";
  contains?: unknown;
  length?: number;
  matches?: string;
  schema?: Record<string, unknown>;
  snapshot?: { name: string; ignore?: string[] };
}

export interface StepAssertion {
  status?: "success" | "error";
  error?: { code?: number; message?: string; matches?: string };
  json?: JsonAssertion | JsonAssertion[];
  /** Fail the step when the request takes longer than this many milliseconds. */
  maxDurationMs?: number;
}

/** Suite-level latency budget checked against recorded run history after each run. */
export interface PerfBudget {
  /** Test name the budget applies to, or "*" for every test. */
  test: string;
  /** Percentile to measure, e.g. 95 for p95. */
  percentile: number;
  /** Budgeted duration in milliseconds. */
  maxMs: number;
  /** Number of recent recorded runs to measure over (default 20). */
  window?: number;
}

export interface StepLifecycle { phase?: "setup" | "test" | "cleanup"; always?: boolean }

export interface RequestStep extends StepLifecycle {
  name?: string;
  request: { method: string; params?: unknown };
  assert?: StepAssertion;
  capture?: Record<string, string>;
  export?: Record<string, { path: string; aggregate?: "single" | "list" | "map"; sensitive?: boolean }>;
  timeoutMs?: number;
}

export interface ToolStep extends StepLifecycle {
  name?: string;
  tool: { name: string; arguments?: Record<string, unknown> };
  assert?: StepAssertion;
  capture?: Record<string, string>;
  export?: Record<string, { path: string; aggregate?: "single" | "list" | "map"; sensitive?: boolean }>;
  timeoutMs?: number;
}

export interface UtilityStep extends StepLifecycle {
  name?: string;
  set: { variable: string; function: string; arguments?: Record<string, unknown> };
}
export interface NativeStep extends StepLifecycle {
  name?: string;
  native: {
    action: "request" | "await-notification" | "subscribe" | "unsubscribe" | "set-log-level" | "list-all" | "task-get" | "task-list" | "task-cancel" | "configure-client";
    behavior?: ClientBehavior;
    method?: string; params?: unknown; uri?: string; level?: string; field?: string;
    timeoutMs?: number; progress?: boolean; cancelAfterMs?: number; taskId?: string;
  };
  assert?: StepAssertion;
  capture?: Record<string, string>;
}

export type TestStep = RequestStep | ToolStep | UtilityStep | NativeStep;

export interface TestCase {
  name: string;
  id?: string;
  logicalName?: string;
  skip?: boolean | string;
  requires?: { capabilities?: string[]; protocolVersions?: string[] };
  dependsOn?: string[];
  variables?: Record<string, unknown>;
  data?: { source: string; row: number; id: string; fingerprint: string };
  steps: TestStep[];
}

export interface Suite {
  version: 1;
  name?: string;
  target: Target;
  targets?: Record<string, Target>;
  budgets?: PerfBudget[];
  defaults?: { timeoutMs?: number };
  redact?: string[];
  extensions?: { functions?: string[]; permissions?: Array<"environment" | "filesystem-read" | "network">; allowlist?: string[]; unsafeLegacy?: boolean };
  client?: ClientBehavior;
  snapshots?: { file?: string; ignore?: string[] };
  tests: TestCase[];
}

export interface StepResult {
  name: string;
  method: string;
  status: "passed" | "failed";
  durationMs: number;
  request?: unknown;
  response?: unknown;
  error?: string;
}

export interface TestResult {
  name: string;
  id?: string;
  status: "passed" | "failed" | "skipped" | "blocked";
  durationMs: number;
  steps: StepResult[];
  outputs?: Record<string, unknown>;
  error?: string;
  /** True when the test passed only after one or more retries (flakiness signal). */
  retried?: boolean;
}

export interface ServerEvidence {
  name?: string;
  version?: string;
  capabilities?: unknown;
}

export interface RunResult {
  schemaVersion: 1;
  suiteName: string;
  status: "passed" | "failed";
  startedAt: string;
  durationMs: number;
  protocolVersions: string[];
  server?: ServerEvidence;
  evidenceHash: string;
  tests: TestResult[];
  outputs: Record<string, unknown>;
  summary: { passed: number; failed: number; skipped: number; blocked: number };
}

export interface SessionInfo {
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  capabilities?: Record<string, unknown>;
}

export interface NativeEvent { method: string; params?: unknown; sequence: number }
export interface NativeRequestOptions { timeoutMs?: number; progress?: boolean; cancelAfterMs?: number; task?: boolean }
export interface NativeRequestResult { result: unknown; progress: unknown[]; taskEvents: unknown[] }
export interface ClientBehavior {
  roots?: Array<{ uri: string; name?: string }>;
  sampling?: { model: string; text: string };
  elicitation?: { action: "accept" | "decline" | "cancel"; content?: Record<string, string | number | boolean | string[]> };
}

export interface TestSession {
  connect(): Promise<SessionInfo>;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  nativeRequest?(method: string, params?: unknown, options?: NativeRequestOptions): Promise<NativeRequestResult>;
  events?(): NativeEvent[];
  awaitEvent?(method: string, timeoutMs?: number): Promise<NativeEvent>;
  subscribe?(uri: string): Promise<unknown>;
  unsubscribe?(uri: string): Promise<unknown>;
  setLoggingLevel?(level: string): Promise<unknown>;
  configureClient?(behavior: ClientBehavior): void;
  close(): Promise<void>;
  diagnostics(): string[];
}

export interface DiscoveryDocument {
  schemaVersion: 1;
  discoveredAt: string;
  target: { transport: Target["transport"] };
  server: ServerEvidence;
  protocolVersion?: string;
  tools: unknown[];
  resources: unknown[];
  resourceTemplates: unknown[];
  prompts: unknown[];
  fingerprint: string;
  diagnostics: string[];
}
