import { readFile } from "node:fs/promises";

const marker = "<!-- mcprigor-action-report -->";
const token = process.env.GH_TOKEN;
const repository = process.env.REPOSITORY;
const pr = process.env.PR_NUMBER;
if (!token || !repository || !pr || !process.env.REPORT_PATH) process.exit(0);
const body = await readFile(process.env.REPORT_PATH, "utf8");
const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
const base = `https://api.github.com/repos/${repository}`;
const response = await fetch(`${base}/issues/${pr}/comments?per_page=100`, { headers });
if (!response.ok) throw new Error(`Unable to list PR comments: ${response.status}`);
const comments = await response.json();
const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(marker));
const url = existing ? `${base}/issues/comments/${existing.id}` : `${base}/issues/${pr}/comments`;
const result = await fetch(url, { method: existing ? "PATCH" : "POST", headers, body: JSON.stringify({ body }) });
if (!result.ok) throw new Error(`Unable to ${existing ? "update" : "create"} PR comment: ${result.status} ${await result.text()}`);
console.log(existing ? "Updated MCP Rigor PR comment." : "Created MCP Rigor PR comment.");
