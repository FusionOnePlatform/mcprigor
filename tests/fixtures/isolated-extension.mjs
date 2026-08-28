export const manifest = { schemaVersion: 1, name: "fixture-extension", version: "1.0.0", permissions: [], functions: ["decorate"], provider: true };
export async function decorate({ value }) { return `isolated:${value}`; }
export const provider = { async load(config) { return [{ id: "extension-row", value: config.value ?? 42 }]; } };
