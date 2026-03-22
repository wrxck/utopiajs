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
        ${entry.html ?? ''}
      </div>
    </article>
  </div>
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
