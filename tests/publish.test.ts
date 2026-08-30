import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishToNetlify, writeLocalBundle } from "../src/publish.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

describe("shareable hosted reports", () => {
  it("deploys files through the digest API and returns the live URL", async () => {
    const uploads: Record<string, string> = {};
    let creates = 0; let polls = 0;
    const server = createServer((req, res) => {
      let body = ""; req.on("data", (part) => body += part);
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/sites/demo-site/deploys") {
          creates++;
          const files = (JSON.parse(body) as { files: Record<string, string> }).files;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "deploy-1", state: "uploading", required: Object.values(files) }));
          return;
        }
        if (req.method === "PUT" && req.url?.startsWith("/deploys/deploy-1/files/")) {
          uploads[decodeURIComponent(req.url.slice("/deploys/deploy-1/files".length))] = body;
          res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
          return;
        }
        if (req.method === "GET" && req.url === "/deploys/deploy-1") {
          polls++;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ state: polls >= 2 ? "ready" : "processing", deploy_ssl_url: "https://deploy-1--demo.netlify.app" }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await listen(server); cleanups.push(() => close(server));
    const port = (server.address() as { port: number }).port;
    const result = await publishToNetlify(
      { "/index.html": "<html>report</html>", "/result.json": "{}\n" },
      { site: "demo-site", token: "secret-token", apiBase: `http://127.0.0.1:${port}` },
    );
    expect(creates).toBe(1);
    expect(result.url).toBe("https://deploy-1--demo.netlify.app");
    expect(result.deployId).toBe("deploy-1");
    expect(uploads["/index.html"]).toBe("<html>report</html>");
    expect(uploads["/result.json"]).toBe("{}\n");
  });

  it("skips uploads that the API did not mark as required", async () => {
    const uploaded: string[] = [];
    const server = createServer((req, res) => {
      let body = ""; req.on("data", (part) => body += part);
      req.on("end", () => {
        if (req.method === "POST") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ id: "d2", state: "uploading", required: [] })); return; }
        if (req.method === "PUT") { uploaded.push(req.url ?? ""); res.writeHead(200).end("{}"); return; }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ state: "ready", ssl_url: "https://d2--demo.netlify.app" }));
      });
    });
    await listen(server); cleanups.push(() => close(server));
    const port = (server.address() as { port: number }).port;
    const result = await publishToNetlify({ "/index.html": "cached" }, { site: "demo-site", token: "t", apiBase: `http://127.0.0.1:${port}` });
    expect(uploaded).toEqual([]);
    expect(result.url).toBe("https://d2--demo.netlify.app");
  });

  it("reports API failures with a stable error code", async () => {
    const server = createServer((_req, res) => res.writeHead(401).end());
    await listen(server); cleanups.push(() => close(server));
    const port = (server.address() as { port: number }).port;
    await expect(publishToNetlify({ "/index.html": "x" }, { site: "demo-site", token: "bad", apiBase: `http://127.0.0.1:${port}` })).rejects.toThrow(/MCP-PUBLISH-001.*401/);
  });

  it("writes a local static bundle when no hosting is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "rigor-publish-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
    const written = await writeLocalBundle({ "/index.html": "<html>ok</html>", "/result.json": "{}\n" }, root);
    expect(written).toHaveLength(2);
    expect(await readFile(join(root, "index.html"), "utf8")).toBe("<html>ok</html>");
    expect(await readFile(join(root, "result.json"), "utf8")).toBe("{}\n");
  });
});

function listen(server: HttpServer): Promise<void> { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function close(server: HttpServer): Promise<void> { return new Promise((resolve) => server.close(() => resolve())); }
