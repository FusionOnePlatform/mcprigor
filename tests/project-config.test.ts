import { describe, expect, it } from "vitest";
import { environmentTarget, parseProjectConfig } from "../src/project-config.js";

describe("mcprigor.config.yaml", () => {
  it("parses command, url, and detailed environments", () => {
    const config = parseProjectConfig(`
default: dev
environments:
  dev: node dist/server.js --verbose
  qa:
    url: https://qa.example.com/mcp
    token from: node get-token.mjs
  prod:
    server: node dist/server.js
    env:
      MODE: production
`, "/proj");
    expect(config.defaultEnvironment).toBe("dev");
    expect(config.environments.dev).toEqual({ transport: "stdio", command: "node", args: ["dist/server.js", "--verbose"] });
    expect(config.environments.qa).toEqual({ transport: "streamable-http", url: "https://qa.example.com/mcp", tokenFrom: "node get-token.mjs" });
    expect(config.environments.prod).toMatchObject({ transport: "stdio", env: { MODE: "production" } });
  });

  it("selects requested and default environments, with clear failures", () => {
    const config = parseProjectConfig(`default: a\nenvironments:\n  a: node a.js\n  b: node b.js\n`, "/proj");
    expect(environmentTarget(config, "b")!.name).toBe("b");
    expect(environmentTarget(config)!.name).toBe("a");
    expect(() => environmentTarget(config, "c")).toThrow(/MCP-PROJ-006/);
    expect(() => environmentTarget(undefined, "qa")).toThrow(/MCP-PROJ-005/);
    expect(environmentTarget(undefined)).toBeUndefined();
  });

  it("rejects malformed configs", () => {
    expect(() => parseProjectConfig("[]", "/p")).toThrow(/MCP-PROJ-001/);
    expect(() => parseProjectConfig("name: x", "/p")).toThrow(/MCP-PROJ-002/);
    expect(() => parseProjectConfig("environments:\n  bad: 42", "/p")).toThrow(/MCP-PROJ-003/);
    expect(() => parseProjectConfig("default: ghost\nenvironments:\n  a: node a.js", "/p")).toThrow(/MCP-PROJ-004/);
  });
});
