import { describe, expect, it } from "vitest";
import { createSession, shutdownSessions } from "../src/session.js";
import { classifyFailure } from "../src/errors.js";

describe("process lifecycle", () => {
  it("classifies a missing server command and closes resources", async () => { const session = createSession({ transport: "stdio", command: `missing-mcprigor-${Date.now()}` }); await expect(session.connect()).rejects.toThrow(/MCP-SPAWN-001/); await shutdownSessions(); });
  it("handles a server exiting before initialization", async () => { const session = createSession({ transport: "stdio", command: process.execPath, args: ["tests/fixtures/broken-exit.mjs"] }); const error = await session.connect().catch((value) => value); expect(["initialization", "transport"]).toContain(classifyFailure(error, "initialization").category); await shutdownSessions(); });
  it("shutdown is idempotent and supports parallel active sessions", async () => { createSession({ transport: "stdio", command: "unused-a" }); createSession({ transport: "stdio", command: "unused-b" }); await shutdownSessions(); await expect(shutdownSessions()).resolves.toBeUndefined(); });
});
