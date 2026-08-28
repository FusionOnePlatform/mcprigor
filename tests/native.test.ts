import { describe, expect, it } from "vitest";
import { runSuite } from "../src/runner.js";
import type { NativeEvent, Suite, TestSession } from "../src/types.js";

function nativeSession(): TestSession {
  const events: NativeEvent[] = [{ sequence: 1, method: "notifications/resources/updated", params: { uri: "fixture://status" } }];
  return {
    connect: async () => ({ capabilities: { resources: { subscribe: true }, logging: {} } }),
    request: async (method, params) => method === "tools/list" && !(params as any)?.cursor ? { tools: [{ name: "one" }], nextCursor: "c1" } : { tools: [{ name: "two" }] },
    nativeRequest: async (_method, _params, options) => ({ result: { ok: true }, progress: options?.progress ? [{ progress: 50 }, { progress: 100 }] : [], taskEvents: [] }),
    events: () => events,
    awaitEvent: async (method) => events.find((event) => event.method === method)!,
    subscribe: async (uri) => ({ subscribed: uri }), unsubscribe: async (uri) => ({ unsubscribed: uri }),
    setLoggingLevel: async (level) => ({ level }), configureClient: () => {}, close: async () => {}, diagnostics: () => [],
  };
}

describe("MCP-native runner", () => {
  it("handles progress, notifications, subscriptions, logging, and pagination", async () => {
    const suite: Suite = { version: 1, target: { transport: "stdio", command: "fixture" }, tests: [{ name: "native", steps: [
      { native: { action: "subscribe", uri: "fixture://status" } },
      { native: { action: "request", method: "tools/call", params: { name: "work" }, progress: true }, assert: { json: { path: "$.progress", length: 2 } } },
      { native: { action: "await-notification", method: "notifications/resources/updated" }, assert: { json: { path: "$.params.uri", equals: "fixture://status" } } },
      { native: { action: "set-log-level", level: "debug" } },
      { native: { action: "list-all", method: "tools/list", field: "tools" }, assert: { json: { path: "$.items", length: 2 } } },
      { native: { action: "unsubscribe", uri: "fixture://status" } },
    ] }] };
    const result = await runSuite(suite, { sessionFactory: nativeSession });
    expect(result.status, JSON.stringify(result.tests, null, 2)).toBe("passed"); expect(result.tests[0]?.steps).toHaveLength(6);
  });

  it("compiles the friendly native vocabulary", async () => {
    const { compileQaLanguage } = await import("../src/qa-language.js");
    const suite = compileQaLanguage(`Suite: "native"\nServer: node fixture.js\nTest: "updates"\n  Subscribe to resource "fixture://status"\n  Wait for notification "notifications/resources/updated" within 2 seconds\n  Expect "params.uri" equals "fixture://status"\n  Unsubscribe from resource "fixture://status"\n`);
    expect((suite.tests[0]?.steps[1] as any).native.action).toBe("await-notification");
  });
});
