import { effect } from '@matthesketh/utopia-core';
import type { HeadConfig, MetaDescriptor, LinkDescriptor } from './types.js';

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
function appendManaged<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): HTMLElementTagNameMap[K] {
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

function metaKey(desc: MetaDescriptor): string {
  if (desc.charset) return 'charset';
  if (desc.httpEquiv) return `http-equiv:${desc.httpEquiv}`;
  if (desc.property) return `property:${desc.property}`;
  if (desc.name) return `name:${desc.name}`;
  return '';
}

function findExistingMeta(desc: MetaDescriptor): Element | null {
  if (desc.charset) return document.head.querySelector('meta[charset]');
  if (desc.httpEquiv) return document.head.querySelector(`meta[http-equiv="${desc.httpEquiv}"]`);
  if (desc.property) return document.head.querySelector(`meta[property="${desc.property}"]`);
  if (desc.name) return document.head.querySelector(`meta[name="${desc.name}"]`);
  return null;
}

function findExistingLink(desc: LinkDescriptor): Element | null {
  const selector = desc.sizes
    ? `link[rel="${desc.rel}"][sizes="${desc.sizes}"]`
    : desc.type
      ? `link[rel="${desc.rel}"][type="${desc.type}"]`
      : `link[rel="${desc.rel}"][href="${desc.href}"]`;
  return document.head.querySelector(selector);
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
  if (desc.content) attrs.content = desc.content;
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

/**
 * Create a reactive head manager. When signals used inside the config
 * function change, the head is automatically updated.
 *
 * @param configFn - Function that returns a HeadConfig (may read signals)
 * @returns Cleanup function that removes managed elements and stops the effect
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
  const dispose = effect(() => {
    setHead(configFn());
  });

  return () => {
    dispose();
    clearManaged();
  };
}

/**
 * Remove all helmet-managed elements from the document head.
 * Useful for cleanup in tests or HMR.
 */
export function resetHead(): void {
  clearManaged();
}
