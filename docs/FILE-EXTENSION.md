# MCP Rigor file extension

MCP Rigor plain-language tests use:

```text
.mcpr
```

Examples:

```text
smoke.mcpr
customer-regression.mcpr
transport-parity.mcpr
```

## Why not `.mcp`?

The `.mcp` suffix predates Model Context Protocol and is already associated with other software, including Metrowerks CodeWarrior project files. Reusing it would create ambiguous editor, operating-system, MIME, and tooling associations.

MCP Rigor therefore uses the product-specific `.mcpr` suffix: **MCP Rigor**.

References checked during the decision:

- [FileInfo: MCP file extension](https://fileinfo.com/extension/mcp)
- [ReviverSoft file-extension registry](https://www.reviversoft.com/file-extensions/mcp)

File-extension registries are not global standards authorities, but existing use is sufficient reason to avoid the collision.

## Migration

Rename files without changing their contents:

```bash
mv tests/smoke.mcp tests/smoke.mcpr
mv tests/shared-flows.mcp tests/shared-flows.mcpr
```

Update flow imports:

```text
Import flows from "./shared-flows.mcpr"
```

Update scripts and CI:

```bash
mcprigor check tests/smoke.mcpr
mcprigor test tests/smoke.mcpr
```

MCP Rigor now rejects `.mcp` files with an actionable rename message. YAML and JSON suite support is unchanged.
