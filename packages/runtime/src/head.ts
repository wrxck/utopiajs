// ============================================================================
// @matthesketh/utopia-runtime — Head management
// ============================================================================
//
// useHead() manipulates document.head to set page title, meta tags, link tags,
// and script tags. Tags are tracked per component and cleaned up on unmount.
// ============================================================================

import { pushDisposer } from './component.js';

// ---------------------------------------------------------------------------
// Attribute allowlists
// ---------------------------------------------------------------------------

const ALLOWED_SCRIPT_ATTRS = new Set([
  'src',
  'type',
  'async',
  'defer',
  'crossorigin',
  'integrity',
  'nomodule',
  'referrerpolicy',
  'nonce',
]);

const ALLOWED_LINK_ATTRS = new Set([
  'rel',
  'href',
  'type',
  'media',
  'sizes',
  'hreflang',
  'crossorigin',
  'integrity',
  'as',
  'disabled',
  'referrerpolicy',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeadConfig {
  title?: string;
  meta?: { name?: string; property?: string; content: string }[];
  link?: { rel: string; href: string; [key: string]: string }[];
  script?: { src: string; [key: string]: string }[];
}

// ---------------------------------------------------------------------------
// useHead — Client implementation
// ---------------------------------------------------------------------------

/**
 * Set document head entries (title, meta, link, script tags).
 *
 * Tags injected by useHead are tracked and removed when the component
 * that called useHead is unmounted.
 */
export function useHead(config: HeadConfig): void {
  const elements: Element[] = [];
  let previousTitle: string | undefined;

  if (config.title) {
    previousTitle = document.title;
    document.title = config.title;
  }

  if (config.meta) {
    for (const meta of config.meta) {
      const el = document.createElement('meta');
      if (meta.name) el.setAttribute('name', meta.name);
      if (meta.property) el.setAttribute('property', meta.property);
      el.setAttribute('content', meta.content);
      document.head.appendChild(el);
      elements.push(el);
    }
  }

  if (config.link) {
    for (const link of config.link) {
      const el = document.createElement('link');
      for (const [key, value] of Object.entries(link)) {
        if (ALLOWED_LINK_ATTRS.has(key.toLowerCase())) {
          el.setAttribute(key, value);
        }
      }
      document.head.appendChild(el);
      elements.push(el);
    }
  }

  if (config.script) {
    for (const script of config.script) {
      const el = document.createElement('script');
      for (const [key, value] of Object.entries(script)) {
        if (ALLOWED_SCRIPT_ATTRS.has(key.toLowerCase())) {
          el.setAttribute(key, value);
        }
      }
      document.head.appendChild(el);
      elements.push(el);
    }
  }

  // Register cleanup to remove injected elements on component unmount.
  pushDisposer(() => {
    for (const el of elements) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    if (previousTitle !== undefined) {
      document.title = previousTitle;
    }
  });
}
