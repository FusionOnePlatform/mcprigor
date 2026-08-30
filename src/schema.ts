export const suiteSchema = {
  $id: "https://mcprigor.dev/schema/suite-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["version", "target", "tests"],
  properties: {
    version: { const: 1 },
    name: { type: "string", minLength: 1 },
    target: { $ref: "#/$defs/target" },
    targets: { type: "object", minProperties: 2, additionalProperties: { $ref: "#/$defs/target" } },
    servers: { type: "object", minProperties: 2, propertyNames: { minLength: 1 }, additionalProperties: { $ref: "#/$defs/target" } },
    budgets: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["test", "percentile", "maxMs"],
        properties: { test: { type: "string", minLength: 1 }, percentile: { type: "number", minimum: 1, maximum: 100 }, maxMs: { type: "integer", minimum: 1 }, window: { type: "integer", minimum: 1, maximum: 1000 } },
      },
    },
    defaults: {
      type: "object", additionalProperties: false,
      properties: { timeoutMs: { type: "integer", minimum: 1, maximum: 600000 } },
    },
    redact: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    extensions: {
      type: "object", additionalProperties: false,
      properties: { functions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, permissions: { type: "array", uniqueItems: true, items: { enum: ["environment", "filesystem-read", "network"] } }, allowlist: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, unsafeLegacy: { type: "boolean" } },
    },
    client: { type: "object" },
    snapshots: { type: "object", additionalProperties: false, properties: { file: { type: "string" }, ignore: { type: "array", items: { type: "string", pattern: "^\\$" } } } },
    tests: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false, required: ["name", "steps"],
        properties: {
          name: { type: "string", minLength: 1 }, server: { type: "string", minLength: 1 }, skip: { oneOf: [{ type: "boolean" }, { type: "string" }] },
          id: { type: "string", minLength: 1 }, logicalName: { type: "string" },
          dependsOn: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
          variables: { type: "object" },
          data: { type: "object" },
          requires: {
            type: "object", additionalProperties: false,
            properties: {
              capabilities: { type: "array", uniqueItems: true, items: { type: "string" } },
              protocolVersions: { type: "array", uniqueItems: true, items: { type: "string" } },
            },
          },
          steps: { type: "array", minItems: 1, items: { $ref: "#/$defs/step" } },
        },
      },
    },
  },
  $defs: {
    target: {
      oneOf: [
        {
          type: "object", additionalProperties: false, required: ["transport", "command"],
          properties: {
            transport: { const: "stdio" }, command: { type: "string", minLength: 1 },
            args: { type: "array", items: { type: "string" } }, cwd: { type: "string" },
            env: { type: "object", additionalProperties: { type: "string" } },
          },
        },
        {
          type: "object", additionalProperties: false, required: ["transport", "url"],
          properties: {
            transport: { const: "streamable-http" }, url: { type: "string", minLength: 1 },
            headers: { type: "object", additionalProperties: { type: "string" } },
            tokenFrom: { type: "string" },
          },
        },
      ],
    },
    assertion: {
      type: "object", additionalProperties: false,
      properties: {
        path: { type: "string", pattern: "^\\$($|\\.|\\[)" }, equals: {}, notEquals: {}, exists: { type: "boolean" },
        type: { enum: ["string", "number", "boolean", "object", "array", "null"] }, contains: {},
        length: { type: "integer", minimum: 0 }, matches: { type: "string", maxLength: 1000 },
        schema: { type: "object" },
        snapshot: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1 }, ignore: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^\\$" } } } },
      },
    },
    assertBlock: {
      type: "object", additionalProperties: false,
      properties: {
        maxDurationMs: { type: "integer", minimum: 1, maximum: 600000 },
        status: { enum: ["success", "error"] },
        error: {
          type: "object", additionalProperties: false,
          properties: { code: { type: "number" }, message: { type: "string" }, matches: { type: "string" } },
        },
        json: { oneOf: [{ $ref: "#/$defs/assertion" }, { type: "array", items: { $ref: "#/$defs/assertion" } }] },
      },
    },
    step: {
      type: "object", additionalProperties: false,
      properties: {
        name: { type: "string" },
        request: {
          type: "object", additionalProperties: false, required: ["method"],
          properties: { method: { type: "string", minLength: 1 }, params: {} },
        },
        tool: {
          type: "object", additionalProperties: false, required: ["name"],
          properties: { name: { type: "string", minLength: 1 }, arguments: { type: "object" } },
        },
        set: {
          type: "object", additionalProperties: false, required: ["variable", "function"],
          properties: { variable: { type: "string" }, function: { type: "string" }, arguments: { type: "object" } },
        },
        native: {
          type: "object", additionalProperties: false, required: ["action"],
          properties: {
            action: { enum: ["request", "await-notification", "subscribe", "unsubscribe", "set-log-level", "list-all", "task-get", "task-list", "task-cancel", "configure-client"] },
            behavior: {
              type: "object", additionalProperties: false,
              properties: {
                roots: { type: "array", items: { type: "object", additionalProperties: false, required: ["uri"], properties: { uri: { type: "string" }, name: { type: "string" } } } },
                sampling: { type: "object", additionalProperties: false, required: ["model", "text"], properties: { model: { type: "string" }, text: { type: "string" } } },
                elicitation: { type: "object", additionalProperties: false, required: ["action"], properties: { action: { enum: ["accept", "decline", "cancel"] }, content: { type: "object" } } },
              },
            },
            method: { type: "string" }, params: {}, uri: { type: "string" }, level: { type: "string" }, field: { type: "string" },
            timeoutMs: { type: "integer", minimum: 1, maximum: 600000 }, progress: { type: "boolean" }, cancelAfterMs: { type: "integer", minimum: 1 }, taskId: { type: "string" },
          },
        },
        phase: { enum: ["setup", "test", "cleanup"] }, always: { type: "boolean" },
        assert: { $ref: "#/$defs/assertBlock" },
        capture: { type: "object", additionalProperties: { type: "string", pattern: "^\\$" } },
        export: { type: "object", additionalProperties: { type: "object", required: ["path"], properties: { path: { type: "string", pattern: "^\\$" }, aggregate: { enum: ["single", "list", "map"] }, sensitive: { type: "boolean" } } } },
        timeoutMs: { type: "integer", minimum: 1, maximum: 600000 },
      },
      oneOf: [
        { required: ["request"], not: { anyOf: [{ required: ["tool"] }, { required: ["set"] }, { required: ["native"] }] } },
        { required: ["tool"], not: { anyOf: [{ required: ["request"] }, { required: ["set"] }, { required: ["native"] }] } },
        { required: ["set"], not: { anyOf: [{ required: ["request"] }, { required: ["tool"] }, { required: ["native"] }] } },
        { required: ["native"], not: { anyOf: [{ required: ["request"] }, { required: ["tool"] }, { required: ["set"] }] } },
      ],
    },
  },
} as const;
