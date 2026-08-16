// End-to-end widget test (jsdom): real page + real built bundle + scripted SSE.
// Verifies the full client pipeline: mount → greeting → send → streaming →
// scanner → executor (scroll/highlight/navigate-confirm) → persistence →
// cross-page memory (history survives "navigation" to another demo page).
// Usage: npm run build && npm run dev &  then  npm run verify:e2e
import { JSDOM } from "jsdom";

const BASE = "http://localhost:8787";
let pass = 0, fail = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${label}`);
  cond ? pass++ : fail++;
};

// The scripted model reply: prose + three actions (fenced, split arbitrarily).
const REPLY =
  "Sure — let me show you around.\n\n" +
  '```json-action\n{"action":"scrollTo","sectionId":"features"}\n```\n' +
  "First, the features section. Now a quick highlight:\n\n" +
  '```json-action\n{"action":"highlight","selector":"#features","durationMs":1500}\n```\n' +
  "And the pricing page is one tap away:\n\n" +
  '```json-action\n{"action":"navigate","path":"/demo/pricing.html"}\n```\n' +
  "That's the tour!";

async function makePage(path) {
  const html = await (await fetch(BASE + path)).text();
  const bundle = await (await fetch(BASE + "/mini-chat.js")).text();
  const dom = new JSDOM(html, { url: BASE + path, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;

  // ── polyfills ──
  w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  w.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  w.Element.prototype.scrollIntoView = function () { (w.__scrollIntoView = w.__scrollIntoView ?? []).push(this.id || this.tagName); };
  const sources = (w.__sources = []);
  w.EventSource = class {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
  };
  if (!w.crypto?.randomUUID) w.crypto = { randomUUID: () => "uuid-" + Math.random().toString(36).slice(2) };

  // ── fetch stub: config + chat capture ──
  w.__chatBodies = [];
  w.fetch = async (url) => {
    if (String(url).includes("/api/config")) {
      return { ok: true, status: 200, json: async () => ({ greetingText: "Hi! I'm the site assistant." }), text: async () => "" };
    }
    if (String(url).includes("/api/chat")) {
      w.__chatBodies.push(w.__lastChatBody); // set below via text()
      return { ok: true, status: 202, json: async () => ({}), text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  };
  // capture the request body (our stub above can't see it)
  const realFetch = w.fetch;
  w.fetch = async (url, init) => { if (String(url).includes("/api/chat") && init?.body) w.__lastChatBody = init.body; return realFetch(url, init); };

  w.eval(bundle);
  w.MiniChat.init({ backendUrl: BASE, agentId: "demo", title: "Lotus assistant", accentColor: "#6d28d9" });
  await sleep(250);
  return w;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shadowOf = (w) => w.document.getElementById("mini-chat-host").shadowRoot;

// ───────────────────────── page 1: /demo/index.html ─────────────────────────
console.log("\n── page 1: /demo/index.html ──");
const w1 = await makePage("/demo/index.html");

ok(!!shadowOf(w1)?.querySelector(".mc-orb-wrap"), "widget mounts (orb in shadow DOM)");
ok(!shadowOf(w1).querySelector(".mc-panel"), "panel starts closed");

// keyboard-activate the orb → panel opens, focus goes to the input
shadowOf(w1).querySelector("button[aria-label]").dispatchEvent(
  new w1.MouseEvent("click", { bubbles: true, detail: 0 }),
);
await sleep(300);
const panel1 = shadowOf(w1).querySelector(".mc-panel");
ok(!!panel1, "panel opens (keyboard activation)");
ok(panel1.textContent.includes("Hi! I'm the site assistant."), "greeting shown (empty history, from /api/config)");

// send a message
const input = panel1.querySelector('input[name="m"]');
input.value = "give me the tour";
panel1.querySelector("form").dispatchEvent(new w1.Event("submit", { bubbles: true, cancelable: true }));
await sleep(300);

const body = JSON.parse(w1.__lastChatBody);
ok(typeof body.sessionId === "string" && body.sessionId.length > 8, "POST /api/chat sent with a sessionId");
ok(body.history.at(-1)?.content === "give me the tour", "history carries the new user message as the last entry");
ok(body.pageContext.sections.length >= 2, `perception sent real page sections (${body.pageContext.sections.length})`);

// stream the scripted reply through the captured EventSource
const es = w1.__sources.at(-1);
ok(!!es && es.url.includes("/api/sse?sessionId="), "SSE stream opened for the session");
for (const chunk of (REPLY.match(/[\s\S]{1,9}/g) ?? [])) {
  es.onmessage({ data: JSON.stringify({ type: "token", value: chunk }) });
  await sleep(5);
}
es.onmessage({ data: JSON.stringify({ type: "done", requestId: "r1" }) });
await sleep(400);

// actions executed?
ok((w1.__scrollIntoView ?? []).includes("features"), "scrollTo executed → #features smooth-centered");
ok(w1.document.getElementById("features").style.outline !== "", "highlight executed → visible inline outline on #features");

// navigate → confirmation bar; answer "Not now" → no navigation
let confirm = shadowOf(w1).querySelector(".mc-confirm");
ok(!!confirm && confirm.textContent.includes("/demo/pricing.html"), "navigate → one-tap confirmation bar shown");
confirm.querySelectorAll("button").forEach((b) => { if (b.textContent === "Not now") b.click(); });
await sleep(200);
ok(!shadowOf(w1).querySelector(".mc-confirm"), "'Not now' dismisses the bar (no navigation)");

// prose: streamed, cleaned, persisted
const panelText = shadowOf(w1).querySelector(".mc-panel").textContent;
ok(panelText.includes("That's the tour!"), "streamed assistant prose rendered");
ok(!panelText.includes("json-action"), "action fences stripped from the visible chat");
const stored1 = JSON.parse(w1.localStorage.getItem("mini-chat:demo"));
ok(stored1.history.length === 2 && stored1.history[1].role === "assistant", "history persisted (user + assistant)");
ok(!stored1.history[1].content.includes("json-action"), "persisted prose is cleaned");
ok(stored1.prefs && typeof stored1.prefs === "object", "prefs object persisted");

// ───────────────────── page 2: /demo/pricing.html (navigation) ──────────────
console.log("\n── page 2: /demo/pricing.html (same browser, after navigation) ──");
// fresh window with page-1 storage seeded BEFORE the widget loads —
// exactly what a real navigation does (localStorage persists, script re-runs)
const html2 = await (await fetch(BASE + "/demo/pricing.html")).text();
const dom2 = new JSDOM(html2, { url: BASE + "/demo/pricing.html", runScripts: "outside-only", pretendToBeVisual: true });
const w4 = dom2.window;
w4.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
w4.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
w4.Element.prototype.scrollIntoView = () => {};
w4.EventSource = class { constructor(u) { this.url = u; } close() {} };
if (!w4.crypto?.randomUUID) w4.crypto = { randomUUID: () => "uuid-" + Math.random().toString(36).slice(2) };
w4.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
w4.localStorage.setItem("mini-chat:demo", w1.localStorage.getItem("mini-chat:demo")); // ← seeded BEFORE load
const bundle2 = await (await fetch(BASE + "/mini-chat.js")).text();
w4.eval(bundle2);
w4.MiniChat.init({ backendUrl: BASE, agentId: "demo", title: "Lotus assistant" });
await sleep(300);

shadowOf(w4).querySelector("button[aria-label]").dispatchEvent(new w4.MouseEvent("click", { bubbles: true, detail: 0 }));
await sleep(300);
const panel4 = shadowOf(w4).querySelector(".mc-panel");
ok(!!panel4, "widget mounts on page 2");
ok(panel4.textContent.includes("give me the tour"), "cross-page memory: user message from page 1 is there");
ok(panel4.textContent.includes("That's the tour!"), "cross-page memory: assistant reply from page 1 is there");
ok(!panel4.textContent.includes("Hi! I'm the site assistant."), "greeting correctly suppressed (history exists)");

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
