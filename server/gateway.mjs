import http from "node:http";
import net from "node:net";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loginPage } from "./login-page.mjs";

// Each account gets its own application process, SQLite database, HH browser
// and session file. The gateway is the only publicly reachable entry point.
const root = process.env.MULTIUSER_DATA_DIR || "/var/lib/resume-bot/users";
const origin = process.env.APP_PUBLIC_ORIGIN;
if (!origin || !/^https:\/\//.test(origin)) throw new Error("APP_PUBLIC_ORIGIN must be an HTTPS origin");
mkdirSync(root, { recursive: true, mode: 0o700 });
const db = new Database(path.join(root, "accounts.db"));
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);`);
db.pragma("foreign_keys = ON");
const workers = new Map();
const attempts = new Map();
const tokenHash = (value) => createHash("sha256").update(value).digest("hex");
const hashPassword = (value, salt) => scryptSync(value, salt, 64);
const session = (req) => {
  const token = /(?:^|;\s*)hh_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
  return token ? db.prepare("SELECT account_id FROM sessions WHERE token_hash=? AND expires>?").get(tokenHash(token), Date.now())?.account_id : undefined;
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => { text += chunk; if (text.length > 4096) { reject(new Error("Слишком большой запрос")); req.destroy(); } });
    req.on("end", () => resolve(text)); req.on("error", reject);
  });
}
function freePort() {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
}
function run(command, args, env) {
  return new Promise((resolve, reject) => { const child = spawn(command, args, { env, stdio: "inherit" }); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Process exited ${code}`))); });
}
async function worker(accountId) {
  const existing = workers.get(accountId);
  if (existing) { existing.lastUsed = Date.now(); return existing.ready; }
  if (workers.size >= 4) throw new Error("Сервер занят. Повторите попытку позднее.");
  const entry = { lastUsed: Date.now() };
  workers.set(accountId, entry);
  entry.ready = (async () => {
    const dir = path.join(root, accountId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const env = { ...process.env, DATABASE_URL: `file:${path.join(dir, "data.db")}`, HH_STORAGE_STATE_PATH: path.join(dir, "hh-auth.json") };
    await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
    const port = await freePort();
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], { env, stdio: "inherit" });
    entry.child = child;
    let spawnError;
    child.on("error", (error) => { spawnError = error; });
    child.on("exit", () => { if (workers.get(accountId) === entry) workers.delete(accountId); });
    for (let i = 0; i < 60; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error("Приложение не запустилось");
      try { const response = await fetch(`http://127.0.0.1:${port}/api/hh/browser`); if (response.ok) return { port, child }; } catch { /* Starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    child.kill(); throw new Error("Приложение не ответило");
  })().catch((error) => { if (workers.get(accountId) === entry) workers.delete(accountId); throw error; });
  return entry.ready;
}
setInterval(async () => {
  for (const [id, entry] of workers) {
    if (Date.now() - entry.lastUsed < 15 * 60 * 1000) continue;
    try {
      const instance = await entry.ready;
      const response = await fetch(`http://127.0.0.1:${instance.port}/api/hh/browser`);
      const data = await response.json();
      if (!data.state?.running && !data.available && Date.now() - entry.lastUsed >= 15 * 60 * 1000) { workers.delete(id); instance.child.kill(); }
    } catch { /* Keep a worker if its state is uncertain. */ }
  }
}, 60_000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", origin);
  if (url.pathname === "/healthz" && req.method === "GET") { res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "text/plain" }).end("ok"); return; }
  const accountId = session(req);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && (req.headers.origin !== origin || req.headers["sec-fetch-site"] === "cross-site")) { res.writeHead(403).end(); return; }
  if (url.pathname === "/account/session" && req.method === "POST") {
    const json = req.headers.accept?.includes("application/json");
    let email = "";
    const errorResponse = (status, message) => {
      res.writeHead(status, { "Content-Type": json ? "application/json; charset=utf-8" : "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(json ? JSON.stringify({ error: message }) : loginPage(message, email));
    };
    try {
      const key = req.socket.remoteAddress + ":" + (req.headers["x-real-ip"] || "");
      const recent = (attempts.get(key) || []).filter((time) => time > Date.now() - 15 * 60_000);
      if (recent.length >= 12) { errorResponse(429, "Слишком много попыток. Попробуйте позже."); return; }
      recent.push(Date.now()); attempts.set(key, recent);
      const form = new URLSearchParams(await readBody(req));
      email = (form.get("email") || "").trim().toLowerCase().slice(0, 255);
      const password = form.get("password") || "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 256) throw new Error("Проверьте почту и пароль (не менее 12 символов).");
      let user = db.prepare("SELECT * FROM accounts WHERE email=?").get(email);
      if (form.get("action") === "register") {
        if (user) throw new Error("Аккаунт уже существует. Войдите в него.");
        const salt = randomBytes(16).toString("hex");
        const passwordHash = salt + ":" + hashPassword(password, salt).toString("hex");
        user = { id: randomUUID() };
        db.prepare("INSERT INTO accounts VALUES (?,?,?)").run(user.id, email, passwordHash);
      } else if (form.get("action") === "login") {
        const [salt, hash] = (user?.password_hash || `${"00".repeat(16)}:${"00".repeat(64)}`).split(":");
        if (!timingSafeEqual(hashPassword(password, salt), Buffer.from(hash, "hex")) || !user) throw new Error("Неверная почта или пароль.");
      } else throw new Error("Неизвестное действие.");
      const token = randomBytes(32).toString("base64url");
      db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(tokenHash(token), user.id, Date.now() + 30 * 86400_000);
      res.writeHead(json ? 200 : 303, { ...(json ? { "Content-Type": "application/json; charset=utf-8" } : { Location: "/" }), "Set-Cookie": `hh_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`, "Cache-Control": "no-store" }).end(json ? JSON.stringify({ ok: true }) : undefined);
    } catch (error) { errorResponse(400, error.message); }
    return;
  }
  if (url.pathname === "/account/logout" && req.method === "POST") {
    const token = /(?:^|;\s*)hh_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || "")?.[1];
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
    res.writeHead(303, { Location: "/", "Set-Cookie": "hh_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" }).end(); return;
  }
  if (!accountId) { if (url.pathname.startsWith("/api/")) res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"Требуется вход"}'); else res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(loginPage()); return; }
  try {
    const instance = await worker(accountId);
    const upstream = http.request({ hostname: "127.0.0.1", port: instance.port, path: req.url, method: req.method, headers: { ...req.headers, host: new URL(origin).host } }, (response) => { res.writeHead(response.statusCode || 502, response.headers); response.pipe(res); });
    res.on("close", () => upstream.destroy());
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  } catch { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("Не удалось запустить рабочее пространство. Повторите попытку позже."); }
}).listen(Number(process.env.PORT || 3013), "127.0.0.1");

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  for (const entry of workers.values()) entry.child?.kill(signal);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});
