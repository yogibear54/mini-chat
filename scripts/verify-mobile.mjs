#!/usr/bin/env node
// Mobile-layout verification (responsive plan, Part C): drives Chrome via CDP
// (browser skill on :9222) through device emulation — portrait, landscape,
// keyboard-shrunk visualViewport, and desktop regression.
// Requires: server on :8787, Chrome on :9222 (web-browser skill).
// NOTE: CDP setDeviceMetricsOverride does NOT fire a window resize event
// (real rotation does) — we dispatch it manually after each override.
import { connect } from "/home/yogibear54/.pi/agent/skills/web-browser/scripts/cdp.js";

const BASE = "http://localhost:8787";
let pass = 0, fail = 0;
const ok = (cond, label) => { console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`); cond ? pass++ : fail++; };

const cdp = await connect();
const pages = await cdp.getPages();
const session = await cdp.attachToPage(pages.at(-1).targetId);

async function evalInPage(expr) { return cdp.evaluate(session, expr); }

async function setDevice(width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 2, mobile: true,
  }, session);
  await cdp.send("Runtime.evaluate", {
    expression: "dispatchEvent(new Event('resize')); true",
    awaitPromise: true, returnByValue: true,
  }, session).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
}

async function measure() {
  return evalInPage(`(() => {
    const host = document.querySelector("#mini-chat-host");
    const p = host?.shadowRoot;
    const panel = p?.querySelector(".mc-panel");
    if (!panel) return { noPanel: true };
    const r = panel.getBoundingClientRect();
    const orb = p.querySelector(".mc-orb-wrap").getBoundingClientRect();
    const ir = panel.querySelector(".mc-input").getBoundingClientRect();
    return {
      vw: innerWidth, vh: innerHeight,
      panel: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) },
      orb: { top: Math.round(orb.top), bottom: Math.round(orb.bottom) },
      inputBottom: Math.round(ir.bottom),
    };
  })()`);
}

async function openPanel() {
  await evalInPage(`(() => {
    document.querySelector("#mini-chat-host").shadowRoot.querySelector("button[aria-label]")
      .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 900));
}

// ── setup: fresh page at mobile portrait ──
await setDevice(390, 844);
await evalInPage(`location.href = "${BASE}/demo/pricing.html"; true`);
await new Promise((r) => setTimeout(r, 2500));
await evalInPage(`localStorage.clear(); location.reload(); true`);
await new Promise((r) => setTimeout(r, 2500));

console.log("\n── portrait 390×844 ──");
await openPanel();
let m = await measure();
ok(m.panel != null, "panel opened");
if (m.panel) {
  ok(m.panel.w <= 390 - 24 + 1, `panel width fits 390px viewport (w=${m.panel.w})`);
  ok(m.panel.bottom <= 844 - 13.5, `panel bottom within viewport (bottom=${m.panel.bottom} ≤ 830)`);
  ok(m.panel.left >= 11.5, `panel left margin ok (left=${m.panel.left})`);
  ok(m.panel.top >= 13.5, `panel top margin ok (top=${m.panel.top})`);
  ok(m.inputBottom <= 844 - 13.5, `input row visible (inputBottom=${m.inputBottom})`);
}

console.log("\n── rotate to landscape 844×390 ──");
await setDevice(844, 390);
m = await measure();
ok(m.panel != null, "panel still open after rotate");
if (m.panel) {
  ok(m.panel.bottom <= 390 - 13.5, `landscape: panel bottom within viewport (bottom=${m.panel.bottom} ≤ 376)`);
  ok(m.panel.top >= 13.5, `landscape: panel top margin ok (top=${m.panel.top})`);
  ok(m.panel.w <= 844 - 24 + 1, `landscape: width fits (w=${m.panel.w})`);
}

console.log("\n── back to portrait, keyboard shrink (visualViewport 390×420) ──");
await setDevice(390, 844);
await evalInPage(`(() => {
  Object.defineProperty(visualViewport, "height", { value: 420, configurable: true });
  visualViewport.dispatchEvent(new Event("resize"));
  return true;
})()`);
await new Promise((r) => setTimeout(r, 600));
m = await measure();
if (m.panel) {
  ok(m.panel.bottom <= 420 + 13.5, `keyboard: panel bottom within shrunk viewport (bottom=${m.panel.bottom} ≤ ~433)`);
  ok(m.inputBottom <= 420 + 13.5, `keyboard: input visible above keyboard (inputBottom=${m.inputBottom})`);
}

console.log("\n── desktop 1280×800 unchanged ──");
await evalInPage(`(() => {
  Object.defineProperty(visualViewport, "height", { value: 800, configurable: true });
  visualViewport.dispatchEvent(new Event("resize"));
  return true;
})()`);
await setDevice(1280, 800);
m = await measure();
if (m.panel) {
  ok(m.panel.w >= 300, `desktop: side-panel width preserved (w=${m.panel.w})`);
  ok(m.panel.bottom <= 800 - 13.5, `desktop: fits vertically (bottom=${m.panel.bottom})`);
}

await cdp.send("Emulation.clearDeviceMetricsOverride", {}, session);
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
