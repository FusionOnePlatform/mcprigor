import { describe, expect, it } from "vitest";
import { callIsolatedFunction, callIsolatedProvider, inspectExtension } from "../src/extension-host.js";
import { callUtility, createFunctionRegistry } from "../src/extensions.js";

const fixture = "tests/fixtures/isolated-extension.mjs";
describe("isolated extension SDK", () => {
  it("inspects manifests and invokes functions in workers", async () => {
    const descriptor = await inspectExtension(fixture, { cwd: process.cwd() });
    expect(descriptor.manifest?.name).toBe("fixture-extension");
    expect(await callIsolatedFunction(fixture, "decorate", { value: "qa" }, { cwd: process.cwd() })).toBe("isolated:qa");
  });
  it("runs data providers in workers", async () => { expect(await callIsolatedProvider(fixture, { value: 7 }, { cwd: process.cwd(), maxRows: 10 }, { cwd: process.cwd() })).toEqual([{ id: "extension-row", value: 7 }]); });
  it("denies ungranted manifest permissions", async () => { await expect(inspectExtension("tests/fixtures/permission-extension.mjs", { cwd: process.cwd() })).rejects.toThrow(/network/); expect((await inspectExtension("tests/fixtures/permission-extension.mjs", { cwd: process.cwd(), permissions: ["network"] })).functions).toContain("work"); });
  it("integrates isolated functions with the registry", async () => { const registry = await createFunctionRegistry({ modules: [fixture], allowCustomCode: true, cwd: process.cwd() }); expect(await callUtility(registry, "decorate", { value: "test" })).toBe("isolated:test"); });
});
