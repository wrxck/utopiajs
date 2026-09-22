import { effect } from '@matthesketh/utopia-core';

import type { HeadConfig, LinkDescriptor, MetaDescriptor } from '@/types';

// ---------------------------------------------------------------------------
// Internal tracking — managed elements are tagged so we can clean them up
// ---------------------------------------------------------------------------

const MANAGED_ATTR = 'data-utopia-helmet';
const managedElements = new Set<Element>();

/** Remove all elements previously injected by helmet. */
function clearManaged(): void {
  for (const el of managedElements) {
    el.remove();
  }
  managedElements.clear();
}

/** Create an element, tag it as managed, and append to <head>. */
function appendManaged(tag: 'meta' | 'link', attrs: Record<string, string>): HTMLElement {
  const el = document.createElement(tag);
  el.setAttribute(MANAGED_ATTR, '');
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  document.head.appendChild(el);
  managedElements.add(el);
  return el;
}

// ---------------------------------------------------------------------------
// Meta tag identity — determines which existing tag to update vs create
// ---------------------------------------------------------------------------

/**
 * escape a value for safe interpolation into a css attribute selector. uses the
 * standard CSS.escape where available, otherwise escapes quotes/backslashes.
 * without this a descriptor value containing `"` produces an invalid selector
 * (querySelector throws a SyntaxError, breaking the reactive head update).
 */
function cssEscape(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
  return escape ? escape(value) : value.replace(/["\\]/g, '\\$&');
}

function findExistingMeta(desc: MetaDescriptor): Element | null {
  try {
    if (desc.charset) return document.head.querySelector('meta[charset]');
    if (desc.httpEquiv) {
      return document.head.querySelector(`meta[http-equiv="${cssEscape(desc.httpEquiv)}"]`);
    }
    if (desc.property)
      return document.head.querySelector(`meta[property="${cssEscape(desc.property)}"]`);
    if (desc.name) return document.head.querySelector(`meta[name="${cssEscape(desc.name)}"]`);
  } catch {
    return null;
  }
  return null;
}

/**
 * rel values that may appear at most once per document. These are matched by
 * rel alone, so calling setLink() with a new href updates the existing tag
 * in place instead of appending a duplicate (two canonicals is invalid).
 */
const SINGLETON_RELS = new Set(['canonical', 'manifest']);

function findExistingLink(desc: LinkDescriptor): Element | null {
  const rel = cssEscape(desc.rel);
  const selector = SINGLETON_RELS.has(desc.rel)
    ? `link[rel="${rel}"]`
    : desc.sizes
      ? `link[rel="${rel}"][sizes="${cssEscape(desc.sizes)}"]`
      : desc.type
        ? `link[rel="${rel}"][type="${cssEscape(desc.type)}"]`
        : `link[rel="${rel}"][href="${cssEscape(desc.href)}"]`;
  try {
    return document.head.querySelector(selector);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Set the document title, optionally applying a template. */
export function setTitle(title: string, template?: string): void {
  document.title = template ? template.replace('%s', title) : title;
}

/** Set or update a single <meta> tag. Merges with existing tags by identity. */
export function setMeta(desc: MetaDescriptor): void {
  const existing = findExistingMeta(desc);
  if (existing) {
    if (desc.content !== undefined) existing.setAttribute('content', desc.content);
    if (desc.charset) existing.setAttribute('charset', desc.charset);
    if (!existing.hasAttribute(MANAGED_ATTR)) {
      existing.setAttribute(MANAGED_ATTR, '');
      managedElements.add(existing);
    }
    return;
  }

  const attrs: Record<string, string> = {};
  if (desc.name) attrs.name = desc.name;
  if (desc.property) attrs.property = desc.property;
  if (desc.httpEquiv) attrs['http-equiv'] = desc.httpEquiv;
  // Preserve an explicitly empty content ('' is meaningful; the update path
  // above also keys on `!== undefined`).
  if (desc.content !== undefined) attrs.content = desc.content;
  if (desc.charset) attrs.charset = desc.charset;
  appendManaged('meta', attrs);
}

/** Set or update a single <link> tag. */
export function setLink(desc: LinkDescriptor): void {
  const existing = findExistingLink(desc);
  if (existing) {
    existing.setAttribute('href', desc.href);
    if (desc.type) existing.setAttribute('type', desc.type);
    if (desc.sizes) existing.setAttribute('sizes', desc.sizes);
    if (desc.media) existing.setAttribute('media', desc.media);
    if (desc.color) existing.setAttribute('color', desc.color);
    if (desc.crossorigin) existing.setAttribute('crossorigin', desc.crossorigin);
    if (desc.as) existing.setAttribute('as', desc.as);
    if (desc.title) existing.setAttribute('title', desc.title);
    if (!existing.hasAttribute(MANAGED_ATTR)) {
      existing.setAttribute(MANAGED_ATTR, '');
      managedElements.add(existing);
    }
    return;
  }

  const attrs: Record<string, string> = { rel: desc.rel, href: desc.href };
  if (desc.type) attrs.type = desc.type;
  if (desc.sizes) attrs.sizes = desc.sizes;
  if (desc.media) attrs.media = desc.media;
  if (desc.color) attrs.color = desc.color;
  if (desc.crossorigin) attrs.crossorigin = desc.crossorigin;
  if (desc.as) attrs.as = desc.as;
  if (desc.title) attrs.title = desc.title;
  appendManaged('link', attrs);
}

/** Set the `lang` attribute on `<html>`. */
export function setHtmlLang(lang: string): void {
  document.documentElement.setAttribute('lang', lang);
}

/** Set the `dir` attribute on `<html>`. */
export function setHtmlDir(dir: 'ltr' | 'rtl' | 'auto'): void {
  document.documentElement.setAttribute('dir', dir);
}

/**
 * Apply a full head configuration. Clears previously managed elements
 * and sets all provided fields.
 *
 * @param config - The head configuration to apply
 */
export function setHead(config: HeadConfig): void {
  clearManaged();

  if (config.title !== undefined) {
    setTitle(config.title, config.titleTemplate);
  }

  if (config.htmlLang) {
    setHtmlLang(config.htmlLang);
  }

  if (config.htmlDir) {
    setHtmlDir(config.htmlDir);
  }

  if (config.themeColor) {
    setMeta({ name: 'theme-color', content: config.themeColor });
  }

  if (config.meta) {
    for (const desc of config.meta) {
      setMeta(desc);
    }
  }

  if (config.link) {
    for (const desc of config.link) {
      setLink(desc);
    }
  }
}

// ---------------------------------------------------------------------------
// useHead — merged, per-caller head entries
// ---------------------------------------------------------------------------

/** One useHead() caller's current configuration. */
interface HeadEntry {
  order: number;
  config: HeadConfig;
}

/** Live useHead() entries, in the order their callers first ran. */
const entries: HeadEntry[] = [];
let entryOrder = 0;

/** Identity of a meta tag, matching findExistingMeta; null when it has none. */
function metaKey(desc: MetaDescriptor): string | null {
  if (desc.charset) return 'charset';
  if (desc.httpEquiv) return `http-equiv:${desc.httpEquiv}`;
  if (desc.property) return `property:${desc.property}`;
  if (desc.name) return `name:${desc.name}`;
  return null;
}

/** Identity of a link tag, matching findExistingLink. */
function linkKey(desc: LinkDescriptor): string {
  if (SINGLETON_RELS.has(desc.rel)) return `rel:${desc.rel}`;
  if (desc.sizes) return `rel:${desc.rel}|sizes:${desc.sizes}`;
  if (desc.type) return `rel:${desc.rel}|type:${desc.type}`;
  return `rel:${desc.rel}|href:${desc.href}`;
}

/**
 * Merge entries in order: a later entry's title, template and html attributes
 * win, and its meta and link tags replace earlier ones with the same identity.
 */
function mergeEntries(list: HeadEntry[]): HeadConfig {
  const merged: HeadConfig = {};
  const metas = new Map<string, MetaDescriptor>();
  const keylessMetas: MetaDescriptor[] = [];
  const links = new Map<string, LinkDescriptor>();

  for (const { config } of list) {
    if (config.title !== undefined) merged.title = config.title;
    if (config.titleTemplate !== undefined) merged.titleTemplate = config.titleTemplate;
    if (config.htmlLang !== undefined) merged.htmlLang = config.htmlLang;
    if (config.htmlDir !== undefined) merged.htmlDir = config.htmlDir;
    if (config.themeColor !== undefined) merged.themeColor = config.themeColor;
    for (const desc of config.meta ?? []) {
      const key = metaKey(desc);
      if (key === null) {
        keylessMetas.push(desc);
      } else {
        metas.delete(key);
        metas.set(key, desc);
      }
    }
    for (const desc of config.link ?? []) {
      const key = linkKey(desc);
      links.delete(key);
      links.set(key, desc);
    }
  }

  merged.meta = [...metas.values(), ...keylessMetas];
  merged.link = [...links.values()];
  return merged;
}

function applyEntries(): void {
  setHead(mergeEntries(entries));
}

let reapplyQueued = false;

/** Re-apply after the current synchronous work (an entry was removed). */
function queueReapply(): void {
  if (reapplyQueued) return;
  reapplyQueued = true;
  queueMicrotask(() => {
    reapplyQueued = false;
    applyEntries();
  });
}

/**
 * Create a reactive head manager. When signals used inside the config
 * function change, the head is automatically updated.
 *
 * Every live useHead() caller contributes an entry, and the document head is
 * the merge of all of them in the order they first ran: a later entry's title
 * wins, and its meta and link tags replace earlier tags with the same
 * identity. A layout and a page can therefore each declare their part of the
 * head. (Each call used to clear every managed tag and apply only its own
 * config, so the two erased each other, and one caller's cleanup removed the
 * other's tags too.)
 *
 * The entry is removed when the returned cleanup runs or when the effect is
 * disposed — which, inside a component's setup, happens on unmount.
 *
 * During server rendering (no `document`) this is a no-op.
 *
 * @param configFn - Function that returns a HeadConfig (may read signals)
 * @returns Cleanup function that removes this entry's tags and stops the effect
 *
 * @example
 * ```ts
 * const title = signal('Home');
 * const cleanup = useHead(() => ({
 *   title: title(),
 *   titleTemplate: '%s | My App',
 *   meta: [
 *     { name: 'description', content: 'Welcome' },
 *   ],
 * }));
 * ```
 */
export function useHead(configFn: () => HeadConfig): () => void {
  if (typeof document === 'undefined') return () => {};

  const entry: HeadEntry = { order: ++entryOrder, config: {} };

  const dispose = effect(() => {
    entry.config = configFn();
    // (re-)insert in first-run order so precedence never depends on which
    // entry changed last.
    let i = entries.length;
    while (i > 0 && entries[i - 1]!.order > entry.order) i--;
    entries.splice(i, 0, entry);
    applyEntries();
    return () => {
      // runs before each re-run (which re-inserts synchronously) and on
      // disposal (which does not) — the queued re-apply covers the latter.
      const at = entries.indexOf(entry);
      if (at !== -1) entries.splice(at, 1);
      queueReapply();
    };
  });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    dispose();
    applyEntries();
  };
}

/**
 * Remove all helmet-managed elements from the document head.
 * Useful for cleanup in tests or HMR.
 */
export function resetHead(): void {
  // forget the live useHead() entries too, or the next apply would bring
  // their tags straight back.
  entries.length = 0;
  clearManaged();
}
