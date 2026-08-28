import { describe, expect, it, vi } from "vitest";
import { clearDataCache, loadData } from "../src/data.js";

describe("data engineering", () => {
  it("coerces, validates, derives, filters, and samples deterministically", async () => {
    const config = {
      provider: "inline", rows: [
        { id: "a", quantity: "10", active: "yes", date: "2025-01-01", tier: "gold", first: "Ada", last: "Lovelace" },
        { id: "b", quantity: "2", active: "no", date: "2025-02-01", tier: "silver", first: "Grace", last: "Hopper" },
        { id: "c", quantity: "7", active: "true", date: "2025-03-01", tier: "gold", first: "Katherine", last: "Johnson" },
      ],
      columns: { quantity: { type: "number", required: true }, active: "boolean", date: "date", tier: { type: "string", enum: ["gold", "silver"] } },
      derive: { fullName: "${first} ${last}", label: "${id}:${quantity}" },
      where: { active: true, quantity: { greaterThan: 5 } },
      sample: { count: 1, seed: 42 },
    };
    const first = await loadData(config); const second = await loadData(config);
    expect(first.rows).toHaveLength(1); expect(first.rows[0]?.values.quantity).toBeTypeOf("number");
    expect(first.rows[0]?.values.fullName).toMatch(/Ada|Katherine/); expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("reports typed column errors with row provenance", async () => {
    await expect(loadData({ provider: "inline", rows: [{ count: "many" }], columns: { count: { type: "number", required: true } } })).rejects.toThrow(/Row 1.*count.*number/);
    await expect(loadData({ provider: "inline", rows: [{}], columns: { name: { type: "string", required: true } } })).rejects.toThrow(/required column/);
  });

  it("joins datasets with inner and left semantics", async () => {
    const base = { provider: "inline", rows: [{ id: "1", name: "one" }, { id: "2", name: "two" }] };
    const joined = await loadData({ ...base, join: { provider: "inline", rows: [{ id: "1", region: "west" }], on: "id", kind: "left", prefix: "account_" } });
    expect(joined.rows[0]?.values).toEqual({ account_region: "west", id: "1", name: "one" });
    expect(joined.rows[1]?.values).toEqual({ id: "2", name: "two" });
  });

  it("caches providers explicitly without exposing mutable cached rows", async () => {
    clearDataCache();
    const config = { provider: "inline", rows: [{ id: 1 }], cache: true };
    const first = await loadData(config); first.rows[0]!.values.id = 99;
    const second = await loadData(config);
    expect(second.rows[0]?.values.id).toBe(1);
  });
});
