import type { SeoConfig, SeoEntry } from './types.js';
import { generateMetaTags, generateJsonLd } from './meta.js';

/** Extract <script> and <link rel="stylesheet"> tags from the built index.html */
export function extractAssetTags(indexHtml: string): { scripts: string; styles: string } {
  const scriptMatches =
    indexHtml.match(/<script[^>]*type="module"[^>]*src="[^"]*"[^>]*><\/script>/g) || [];
  const styleMatches =
    indexHtml.match(/<link[^>]*rel="stylesheet"[^>]*href="[^"]*"[^>]*\/?>/g) || [];

  return {
    scripts: scriptMatches.join('\n  '),
    styles: styleMatches.join('\n  '),
  };
}

/** Generate a pre-rendered HTML page for a blog post */
export function generatePrerenderedPage(
  entry: SeoEntry,
  config: SeoConfig,
  assets: { scripts: string; styles: string },
): string {
  const metaTags = generateMetaTags(entry, config);
  const jsonLd = generateJsonLd(entry, config);
  const dateStr = new Date(entry.date).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${metaTags}
  <meta name="theme-color" content="#ffffff">
  <link rel="alternate" type="application/rss+xml" title="RSS Feed" href="/feed.xml">
  <link rel="alternate" type="application/atom+xml" title="Atom Feed" href="/atom.xml">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;700&display=swap" rel="stylesheet">
  ${assets.styles}
  ${jsonLd}
</head>
<body>
  <div id="app">
    <article>
      <header>
        <h1>${escapeHtml(entry.title)}</h1>
        <time datetime="${new Date(entry.date).toISOString()}">${dateStr}</time>
      </header>
      <div class="prose">
        ${sanitiseHtml(entry.html ?? '')}
      </div>
    </article>
  </div>
  <script>document.getElementById('app').innerHTML=''</script>
  ${assets.scripts}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Allowlist-based HTML sanitiser (server-side)
// ---------------------------------------------------------------------------
// Mirrors the approach used in packages/runtime/src/dom.ts but implemented
// with jsdom so it works in the Node.js build-time context.
// ---------------------------------------------------------------------------

/**
 * HTML elements whose tags are safe to keep in rendered markdown.
 * Anything not in this set is replaced with its text children.
 */
const SAFE_TAGS = new Set([
  'a', 'abbr', 'acronym', 'address', 'article', 'aside',
  'b', 'bdi', 'bdo', 'big', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em',
  'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'i', 'img', 'ins',
  'kbd',
  'li',
  'main', 'mark', 'menu',
  'nav',
  'ol',
  'p', 'picture', 'pre',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr',
  'u', 'ul',
  'var',
  'wbr',
]);

/**
 * Attributes that are safe on any element.
 * Event handler attributes (on*) and dangerous globals are excluded.
 */
const SAFE_ATTRS = new Set([
  'abbr', 'align', 'alt', 'axis',
  'border',
  'cellpadding', 'cellspacing', 'char', 'charoff', 'charset', 'cite', 'class', 'cols',
  'colspan', 'compact',
  'datetime', 'dir',
  'frame',
  'headers', 'height', 'hreflang',
  'id',
  'lang',
  'nowrap',
  'rel', 'reversed', 'rowspan', 'rules',
  'scope', 'span', 'start', 'summary',
  'tabindex', 'target', 'title', 'type',
  'valign', 'value',
  'width',
]);

/** URI-bearing attributes that must not contain javascript:/data:/vbscript: values. */
const URI_ATTRS = new Set(['href', 'src', 'action', 'cite', 'poster', 'data']);

/** Schemes that are forbidden in URI attributes. */
const DANGEROUS_SCHEME_RE = /^\s*(?:javascript|data|vbscript)\s*:/i;

/**
 * Tags whose entire subtree (including text content) must be dropped.
 * Unlike other disallowed tags whose text children are preserved, these
 * elements are removed completely because their text content is executable
 * or otherwise dangerous.
 */
const DROP_ENTIRELY = new Set(['script', 'style', 'iframe', 'object', 'embed', 'base']);

/**
 * DOM-based HTML sanitiser for server-side (build-time) use.
 *
 * Parses the input into an inert document using jsdom, walks every element,
 * removes disallowed tags (preserving their text children) and strips all
 * event-handler attributes, non-allowlisted attributes, and dangerous URI
 * schemes (javascript:, data:, vbscript:) from href/src/action/etc.
 *
 * Using a real HTML parser means bypass techniques (nested tags, SVG vectors,
 * unusual attribute quoting) cannot slip through the way they can with regex.
 */
function sanitiseHtml(html: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JSDOM } = require('jsdom') as typeof import('jsdom');
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`);
  const body = dom.window.document.body;

  // Collect elements bottom-up so parent removals don't invalidate the list.
  const elements: Element[] = [];
  const walker = dom.window.document.createTreeWalker(
    body,
    0x1 /* NodeFilter.SHOW_ELEMENT */,
  );
  let node = walker.nextNode();
  while (node !== null) {
    elements.push(node as Element);
    node = walker.nextNode();
  }

  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    const tag = el.tagName.toLowerCase();

    if (DROP_ENTIRELY.has(tag)) {
      // Remove the element AND its content entirely (no text children kept).
      el.parentNode?.removeChild(el);
      continue;
    }

    if (!SAFE_TAGS.has(tag)) {
      // Replace the disallowed element with its children to preserve text.
      const frag = dom.window.document.createDocumentFragment();
      while (el.firstChild) {
        frag.appendChild(el.firstChild);
      }
      el.parentNode?.replaceChild(frag, el);
      continue;
    }

    // Sanitise attributes on allowed elements.
    const attrsToRemove: string[] = [];
    for (let j = 0; j < el.attributes.length; j++) {
      const attr = el.attributes[j];
      const name = attr.name.toLowerCase();

      // Block all event-handler attributes (on*).
      if (name.startsWith('on')) {
        attrsToRemove.push(attr.name);
        continue;
      }

      // Block dangerous URI schemes in URI-bearing attributes.
      if (URI_ATTRS.has(name)) {
        if (DANGEROUS_SCHEME_RE.test(attr.value)) {
          attrsToRemove.push(attr.name);
        }
        // Safe URIs (http, https, mailto, relative paths, etc.) are kept.
        continue;
      }

      // Remove any attribute not on the safe list.
      if (!SAFE_ATTRS.has(name)) {
        attrsToRemove.push(attr.name);
      }
    }

    for (const name of attrsToRemove) {
      el.removeAttribute(name);
    }
  }

  return body.innerHTML;
}
