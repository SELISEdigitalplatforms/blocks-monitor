import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";

const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, ["--experimental-sqlite", "dist-server/production.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, PORT: String(port), FACTORY_PLATFORM: "blocks", VITE_BLOCKS_AUTH_MODE: "embedded",
    MF_APP_ORIGIN: "https://factory.example", MF_BLOCKS_TENANT: "smoke-test",
    MF_SVC_CLIENT_ID: "smoke-test", MF_SVC_CLIENT_SECRET: "synthetic-test-secret",
    GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", MF_GITHUB_TOKEN_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (s) => { output += s; });
child.stderr.on("data", (s) => { output += s; });
function request(path, { host = "factory.example", method = "GET", accept = "text/html" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers: { host, accept } }, (res) => {
      let body = ""; res.on("data", (s) => { body += s; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); req.end();
  });
}
try {
  const deadline = Date.now() + 15000;
  while (!output.includes("HTTP server listening")) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Server did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await request("/healthz", { host: "127.0.0.1" })).status, 200);
  assert.equal((await request("/", { host: "other.example" })).status, 421);
  assert.equal((await request("/", { accept: "*/*" })).status, 200);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/);
  assert.ok(page.headers["content-security-policy"]);
  assert.ok(!page.body.includes("__mf_csp_nonce__"));
  assert.equal(page.headers["cache-control"], "no-store");
  const second = await request("/projects/example");
  assert.equal(second.status, 200);
  assert.notEqual(page.headers["content-security-policy"], second.headers["content-security-policy"]);
  const head = await request("/", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(head.body, "");
  assert.equal((await request("/.env.local")).status, 404);
  assert.equal((await request("/missing.js")).status, 404);
  assert.equal((await request("/api/missing", { accept: "application/json" })).status, 503);
  const session = await request("/api/auth/session", { accept: "application/json" });
  assert.equal(session.status, 401);
  assert.ok(!session.body.includes("synthetic-test-secret"));
  console.log("Production smoke checks passed: health, host validation, SPA, CSP nonces, HEAD, private paths, API routing and anonymous session.");
} finally {
  child.kill();
}
