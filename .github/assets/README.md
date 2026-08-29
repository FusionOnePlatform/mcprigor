# README demo recording

The demo GIF is recorded with [VHS](https://github.com/charmbracelet/vhs) against a real MCP server.

To re-record (e.g. after output format changes):

```bash
mkdir -p /tmp/mcprigor-demo && cd /tmp/mcprigor-demo
npm init -y && npm install mcprigor @modelcontextprotocol/sdk zod
cp <repo>/.github/assets/{server.mjs,orders.mcpr,demo.tape} .
vhs demo.tape
cp demo.gif <repo>/.github/assets/demo.gif
```
