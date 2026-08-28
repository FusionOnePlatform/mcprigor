# Isolated Extension SDK

MCP Rigor 0.13 changes custom functions and data providers from direct host imports to worker-isolated extensions.

```js
export const manifest = {
  schemaVersion: 1,
  name: "customer-utilities",
  version: "1.0.0",
  permissions: [],
  functions: ["normalizeCustomer"],
  provider: true
};

export function normalizeCustomer({ value }) {
  return String(value).trim().toUpperCase();
}

export const provider = {
  async load(config) {
    return [{ id: "case-1", expected: config.expected }];
  }
};
```

Enable reviewed extensions as before:

```bash
mcprigor test suite.mcpr --allow-custom-code
```

Execution now occurs in a dedicated Node worker with:

- a reviewed versioned manifest;
- explicit permissions;
- wall-clock timeout and forced termination;
- a 64 MiB default V8 old-generation limit;
- JSON-compatible inputs and outputs only;
- stable `MCP-EXT-1xx` diagnostics;
- no automatic fallback to direct host import.

Manifest permissions currently recognized:

- `environment`
- `filesystem-read`
- `network`

A requested permission must be granted by suite configuration. Permissions describe review intent in the current worker backend; they are not yet a complete host-brokered filesystem/network sandbox.

## Public SDK

```js
import { defineExtension, defineManifest } from "mcprigor";

export const manifest = defineManifest({
  schemaVersion: 1,
  name: "example",
  version: "1.0.0",
  permissions: [],
  functions: ["decorate"]
});

export default defineExtension({ manifest });
```

Programmatic host APIs:

- `inspectExtension()`
- `callIsolatedFunction()`
- `callIsolatedProvider()`

## Legacy compatibility

Existing modules can still execute directly only when the suite explicitly selects `extensions.unsafeLegacy: true` or a provider uses `unsafeLegacy: true`. This mode has the full authority of the MCP Rigor process and should only be used temporarily while migrating.

Worker threads improve failure and capability isolation, but they are not a hard hostile-code security boundary. Truly untrusted extensions should run in a separately secured process or container.
