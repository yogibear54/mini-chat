#!/usr/bin/env node
// Server control: start / stop / restart / status for the mini-chat backend.
//
//   npm start | npm run stop | npm run restart | npm run status
//
// Why not just pkill: `tsx watch` SUPERVISES its child — killing whichever
// process holds the port makes the supervisor respawn it. Stop therefore
// kills (a) the process group we started (pid file), (b) this repo's tsx
// binary by full path (kills supervisors started any other way — including
// a foreground `npm run dev`), and (c) whatever still holds the port.
// Patterns are scoped to THIS repo so other projects' tsx servers survive.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, copyFileSync, openSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = resolve(root, "server");
const LOG = "/tmp/mini-chat-server.log";
const PID_FILE = "/tmp/mini-chat-server.pid";

function port() {
  try {
    const env = readFileSync(resolve(serverDir, ".env"), "utf8");
    const m = env.match(/^PORT=(\d+)/m);
    if (m) return m[1];
  } catch { /* no .env yet */ }
  return "8787";
}
const P = port();

const sh = (cmd, opts = {}) =>
  spawnSync(cmd, { shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const isUp = () =>
  sh(`curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:${P}/api/config`)
    .stdout?.trim() === "200";

function stop() {
  // (a) our own process group (started via `npm start`)
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
    if (Number.isFinite(pid)) {
      try { process.kill(-pid, "SIGTERM"); } catch { /* group already gone */ }
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
    rmSync(PID_FILE, { force: true });
  }
  // (b) any tsx running THIS repo (supervisors included), never other projects'
  sh(`pkill -f "${root}/node_modules/.bin/tsx" 2>/dev/null; true`);
  // (c) whatever still holds the port
  sh(`fuser -k ${P}/tcp 2>/dev/null; true`);

  for (let i = 0; i < 20 && isUp(); i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); // sleep 150ms
  }
  if (isUp()) {
    console.error(`✗ still listening on :${P} after stop — check lsof -i :${P}`);
    process.exit(1);
  }
  console.log(`✓ stopped (port ${P} free)`);
}

function start() {
  if (isUp()) {
    console.log(`• already running on http://localhost:${P} (stop first, or use restart)`);
    return;
  }
  // first-run convenience: copy .env.example so a fresh clone just works
  const envFile = resolve(serverDir, ".env");
  if (!existsSync(envFile) && existsSync(resolve(serverDir, ".env.example"))) {
    copyFileSync(resolve(serverDir, ".env.example"), envFile);
    console.log("• created server/.env from .env.example (set PROVIDER/LLM_* for a real model)");
  }

  const logFd = openSync(LOG, "a");
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: serverDir,
    detached: true,          // own process group → stop can kill the whole tree
    stdio: ["ignore", logFd, logFd],
    env: process.env,        // forwards DEBUG_REPLIES etc.
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  // wait for it to actually answer
  for (let i = 0; i < 60 && !isUp(); i++) {
    if (child.exitCode !== null) {
      console.error(`✗ server exited during startup — last log lines:`);
      console.error(sh(`tail -15 ${LOG}`).stdout);
      process.exit(1);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!isUp()) {
    console.error(`✗ no response on :${P} after 15s — tail ${LOG}`);
    process.exit(1);
  }
  const boot = sh(`grep -m2 "provider=\\|listening" ${LOG} | tail -2`).stdout?.trim();
  console.log(`✓ running on http://localhost:${P}  (log: ${LOG})`);
  if (boot) console.log(boot.split("\n").map((l) => `  ${l}`).join("\n"));
  console.log(`  demo: http://localhost:${P}/demo/index.html`);
}

function status() {
  const up = isUp();
  console.log(`mini-chat server: ${up ? "UP" : "DOWN"} on port ${P}`);
  if (up) {
    const who = sh(`lsof -ti :${P} -sTCP:LISTEN 2>/dev/null`).stdout?.trim();
    if (who) console.log(`  pid(s): ${who.split("\n").join(", ")}`);
  }
  process.exitCode = up ? 0 : 1;
}

const cmd = process.argv[2];
if (cmd === "start") start();
else if (cmd === "stop") stop();
else if (cmd === "restart") { stop(); start(); }
else if (cmd === "status") status();
else {
  console.log("usage: serverctl.mjs start|stop|restart|status");
  process.exit(1);
}
