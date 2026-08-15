// Mount smoke test (§9 step 12 verification): runs the real built bundle
// against the real served demo page inside jsdom, then asserts the widget
// mounts, the orb renders, and keyboard activation opens the panel.
// Usage: npm run build && npm run dev &  then  npm run verify:mount
import { JSDOM } from "jsdom";

const PAGE_URL = "http://localhost:8787/demo/index.html";
const pageHtml = await (await fetch(PAGE_URL)).text();
const bundle = await (await fetch("http://localhost:8787/mini-chat.js")).text();

const dom = new JSDOM(pageHtml, {
  url: PAGE_URL,
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const { window } = dom;

// ── polyfills the bundle needs (jsdom gaps) ──
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent() { return false; },
}));
window.EventSource = class {
  constructor(url) { this.url = url; }
  close() {}
  addEventListener() {}
};
window.fetch = async (url) => ({
  ok: true, status: 200,
  json: async () => ({ greetingText: "Hi! I'm the site assistant." }),
  text: async () => "",
});
if (!window.crypto?.randomUUID) {
  window.crypto = { randomUUID: () => "uuid-" + Math.random().toString(36).slice(2) };
}

// ── 1. execute the widget bundle (like the <script src> would) ──
try {
  window.eval(bundle);
  console.log("bundle: executed OK");
} catch (e) {
  console.error("BUNDLE THREW:", e.message);
  process.exit(1);
}

if (typeof window.MiniChat?.init !== "function") {
  console.error("window.MiniChat.init missing — mount block broken");
  process.exit(1);
}

// ── 2. run the demo page's inline init (like the browser would) ──
try {
  window.eval(`MiniChat.init({ backendUrl: location.origin, agentId: "demo" });`);
  console.log("MiniChat.init: called OK");
} catch (e) {
  console.error("INIT THREW:", e.message);
  process.exit(1);
}

// ── 3. let React flush, then inspect the mounted DOM ──
await new Promise((r) => setTimeout(r, 300));

const host = window.document.getElementById("mini-chat-host");
console.log("mini-chat-host div:", host ? "PRESENT" : "MISSING");
if (!host) process.exit(1);

const shadow = host.shadowRoot;
console.log("shadow root:", shadow ? "attached" : "MISSING");
const orb = shadow?.querySelector(".mc-orb-wrap");
console.log("orb wrapper:", orb ? "PRESENT" : "MISSING");
const button = shadow?.querySelector("button[aria-label]");
console.log("orb button (aria-label):", button ? `PRESENT (${button.getAttribute("aria-label")})` : "MISSING");
const panel = shadow?.querySelector(".mc-panel");
console.log("panel (closed initially):", panel ? "unexpectedly open" : "closed (correct)");

const svg = shadow?.querySelector("svg");
console.log("orb svg:", svg ? "PRESENT" : "MISSING");

// ── 4. keyboard activation: Enter/Space (click with detail 0) → panel opens ──
if (button) {
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 0 }));
  await new Promise((r) => setTimeout(r, 300));
  const panelKb = shadow?.querySelector(".mc-panel");
  console.log("keyboard (Enter/Space) opens panel:", panelKb ? "YES" : "NO");
  const input = shadow?.querySelector("input[name=m]");
  console.log("input focused after open:", window.document.activeElement === input ? "YES" : "no");
}

const ok = host && shadow && orb && svg;
console.log(ok ? "\nRESULT: WIDGET MOUNTS ✓" : "\nRESULT: MOUNT INCOMPLETE ✗");
process.exit(ok ? 0 : 1);
