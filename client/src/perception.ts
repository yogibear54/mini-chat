import type { PageContext, SectionRef } from "@shared/types";

// Perception (PLAN.md §3.3 / ticket 09). Pure helpers are unit-tested; the DOM
// scan, scrollspy, and route watcher are thin wiring, manually verified.

// ─── Pure helpers ───────────────────────────────────────────────────────────

export interface LabelSource {
  aria: string;
  mini: string;
  heading: string;
  id: string;
}

export function deriveLabel(src: LabelSource): string {
  const raw = src.aria.trim() || src.mini.trim() || src.heading.trim() || src.id.trim();
  return raw.length > 80 ? raw.slice(0, 80) : raw;
}

export function slugify(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

export function assignId(existingId: string, label: string, taken: Set<string>): string {
  if (existingId) return existingId;
  let slug = slugify(label);
  if (!/^[a-z]/.test(slug)) slug = `s${slug}`; // ids must start with a letter
  let id = `mini-s-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `mini-s-${slug}-${n}`;
  return id;
}

// ─── DOM wiring ─────────────────────────────────────────────────────────────

const SCAN_SELECTOR = "h1, h2, h3, section[id], [data-mini-section]";

export interface TrackedSection extends SectionRef {
  el: Element;
}

export interface Perception {
  scan(): void;
  getPageContext(): PageContext;
  onCurrentSection(cb: (id: string | undefined) => void): void;
  destroy(): void;
}

export function createPerception(doc: Document = document): Perception {
  // id stability across SPA re-scans: same element ⇒ same id (§3.3, ticket 09)
  const idByElement = new WeakMap<Element, string>();
  let sections: TrackedSection[] = [];
  let currentSectionId: string | undefined;
  let currentCb: ((id: string | undefined) => void) | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  let cleanupRouteWatch: (() => void) | undefined;

  function scan(): void {
    const els = Array.from(doc.querySelectorAll(SCAN_SELECTOR));
    const taken = new Set<string>(els.map((el) => el.id).filter(Boolean));
    const next: TrackedSection[] = [];
    for (const el of els) {
      let id = idByElement.get(el) ?? assignId(el.id, labelFor(el), taken);
      if (!el.id) el.id = id; // only ADD ids, never mutate existing (§3.3)
      taken.add(id);
      idByElement.set(el, id);
      next.push({ el, id, label: deriveLabel(labelSource(el)) });
    }
    sections = next;
    watch();
  }

  function labelSource(el: Element): LabelSource {
    const heading =
      el instanceof HTMLElement && /^H[1-3]$/.test(el.tagName)
        ? el.innerText
        : (el.querySelector("h1, h2, h3")?.textContent ?? "");
    return {
      aria: el.getAttribute("aria-label") ?? "",
      mini: el.getAttribute("data-mini-label") ?? "",
      heading,
      id: el.id,
    };
  }

  function labelFor(el: Element): string {
    return deriveLabel(labelSource(el));
  }

  /** Central-band scrollspy: a section is active in the middle 20% of the viewport. */
  function watch(): void {
    observer?.disconnect();
    const active = new Set<string>();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = idByElement.get(e.target);
          if (!id) continue;
          if (e.isIntersecting) active.add(id);
          else active.delete(id);
        }
        const topmost = sections.find((s) => active.has(s.id))?.id; // document order = topmost
        if (topmost && topmost !== currentSectionId) {
          currentSectionId = topmost;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => currentCb?.(currentSectionId), 150);
        }
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 },
    );
    for (const s of sections) observer.observe(s.el);
  }

  function getPageContext(): PageContext {
    const meta = doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined;
    return {
      url: location.href,
      title: doc.title,
      path: location.pathname + location.search,
      metaDescription: meta,
      sections: sections.map(({ id, label }) => ({ id, label })),
      currentSectionId,
    };
  }

  /** Re-scan on SPA route changes: popstate + hashchange + pushState/replaceState hook (§3.3). */
  function watchRoutes(): () => void {
    const onRoute = () => setTimeout(scan, 0); // let the new route render first
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = ((...args: Parameters<typeof origPush>) => {
      const r = origPush(...args);
      onRoute();
      return r;
    }) as typeof history.pushState;
    history.replaceState = ((...args: Parameters<typeof origReplace>) => {
      const r = origReplace(...args);
      onRoute();
      return r;
    }) as typeof history.replaceState;
    addEventListener("popstate", onRoute);
    addEventListener("hashchange", onRoute);
    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      removeEventListener("popstate", onRoute);
      removeEventListener("hashchange", onRoute);
    };
  }

  scan();
  cleanupRouteWatch = watchRoutes();

  return {
    scan,
    getPageContext,
    onCurrentSection(cb) {
      currentCb = cb;
    },
    destroy() {
      observer?.disconnect();
      clearTimeout(debounceTimer);
      cleanupRouteWatch?.();
    },
  };
}
