import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(os.tmpdir(), "hh-multiuser-"));
const base = "http://127.0.0.1:3019";
const origin = "https://bot.example";
const child = spawn(process.execPath, ["server/gateway.mjs"], { env: { ...process.env, PORT: "3019", APP_PUBLIC_ORIGIN: origin, MULTIUSER_DATA_DIR: dir }, stdio: "inherit" });
const request = (route, options = {}) => fetch(base + route, { redirect: "manual", ...options, headers: { origin, ...options.headers } });
try {
  let ready = false;
  for (let i = 0; i < 50; i++) { try { if ((await request("/healthz")).ok) { ready = true; break; } } catch { /* Starting. */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.ok(ready);
  assert.equal((await request("/api/settings")).status, 401);
  async function account(email, action = "register") {
    const response = await request("/account/session", { method: "POST", body: new URLSearchParams({ email, password: "example-password-123", action }) });
    assert.equal(response.status, 303);
    return response.headers.get("set-cookie").split(";")[0];
  }
  const a = await account("a@example.test");
  const b = await account("b@example.test");
  const headers = (cookie) => ({ cookie, "content-type": "application/json" });
  const settingsA = await (await request("/api/settings", { headers: headers(a) })).json();
  assert.equal((await request("/api/settings", { method: "PUT", headers: headers(a), body: JSON.stringify({ profileId: settingsA.settings.id, city: "Казань", keywords: "Врач", resumeText: "" }) })).status, 200);
  const settingsB = await (await request("/api/settings", { headers: headers(b) })).json();
  assert.notEqual(settingsB.settings.city, "Казань");
  const phone = await account("a@example.test", "login");
  assert.equal((await (await request("/api/settings", { headers: headers(phone) })).json()).settings.city, "Казань");
  assert.equal((await request("/account/logout", { method: "POST", headers: headers(a) })).status, 303);
  assert.equal((await request("/api/settings", { headers: headers(a) })).status, 401);
  assert.equal((await request("/api/settings", { headers: headers(phone) })).status, 200);
  assert.equal((await request("/api/settings", { method: "PUT", headers: { ...headers(b), origin: "https://evil.example" }, body: "{}" })).status, 403);
  console.log("OK independent users, shared account across devices, logout and origin protection");
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(dir, { recursive: true, force: true });
}
