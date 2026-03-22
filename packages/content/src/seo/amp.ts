import type { SeoConfig, SeoEntry } from './types.js';
import { generateMetaTags, generateJsonLd } from './meta.js';

const AMP_BOILERPLATE = `<style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript>`;

/** Convert <img> tags to <amp-img> with layout="responsive" */
function convertImages(html: string): string {
  return html.replace(/<img\s([^>]*)>/g, (_, attrs: string) => {
    // Extract src, alt, width, height
    const src = attrs.match(/src="([^"]*)"/)?.[1] ?? '';
    const alt = attrs.match(/alt="([^"]*)"/)?.[1] ?? '';
    const width = attrs.match(/width="([^"]*)"/)?.[1] ?? '800';
    const height = attrs.match(/height="([^"]*)"/)?.[1] ?? '450';
    return `<amp-img src="${src}" alt="${alt}" width="${width}" height="${height}" layout="responsive"></amp-img>`;
  });
}

/** Strip any <script> tags (AMP does not allow custom JS) */
function stripScripts(html: string): string {
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

/** Generate inline CSS for AMP pages (must be under 75KB) */
function generateAmpCss(): string {
  return `
body {
  margin: 0;
  padding: 0;
  font-family: 'DM Mono', monospace;
  background: #fff;
  color: #000;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
article {
  max-width: 72ch;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
h1 {
  font-size: 2rem;
  line-height: 1.3;
  margin: 0 0 0.5rem;
}
time {
  color: #333;
  font-size: 0.9rem;
}
header {
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #000;
}
.prose h2 {
  font-size: 1.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #000;
  margin: 2rem 0 1rem;
}
.prose h3 {
  font-size: 1.25rem;
  margin: 2rem 0 1rem;
}
.prose p {
  margin: 0 0 1.25rem;
  line-height: 1.8;
}
.prose ul, .prose ol {
  padding-left: 1.5rem;
  margin: 0 0 1.25rem;
}
.prose li {
  margin-bottom: 0.5rem;
}
.prose code {
  background: #000;
  color: #fff;
  padding: 0.15rem 0.4rem;
  font-size: 0.9em;
  font-family: 'DM Mono', monospace;
}
.prose pre {
  background: #000;
  color: #fff;
  padding: 1.5rem;
  overflow-x: auto;
  margin: 0 0 1.5rem;
  border: 1px solid #000;
}
.prose pre code {
  background: none;
  padding: 0;
  font-size: 0.85rem;
}
.prose blockquote {
  border-left: 3px solid #000;
  margin: 0 0 1.5rem;
  padding: 0.5rem 0 0.5rem 1.5rem;
  color: #333;
}
.prose a {
  color: #000;
  text-decoration: underline;
}
.prose img, .prose amp-img {
  max-width: 100%;
  border: 1px solid #000;
}
.prose hr {
  border: none;
  border-top: 1px solid #000;
  margin: 2rem 0;
}
.tags {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}
.tags span {
  border: 1px solid #000;
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
}
footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid #000;
  font-size: 0.85rem;
  color: #333;
}
footer a {
  color: #000;
}
`.trim();
}

/** Generate an AMP-compliant HTML page for a blog post */
export function generateAmpPage(entry: SeoEntry, config: SeoConfig): string {
  const canonicalUrl = `${config.siteUrl}/${config.routePrefix ?? 'blog'}/${entry.slug}`;
  const metaTags = generateMetaTags(entry, config)
    // Remove canonical and amphtml links (AMP page has its own canonical above)
    .replace(/<link rel="canonical"[^>]*>\n?\s*/g, '')
    .replace(/<link rel="amphtml"[^>]*>\n?\s*/g, '');
  const jsonLd = generateJsonLd(entry, config);

  const dateStr = new Date(entry.date).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Process content for AMP compliance
  let content = entry.html ?? '';
  content = convertImages(content);
  content = stripScripts(content);

  const tagsHtml = entry.tags
    ? `<div class="tags">${entry.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html amp lang="en">
<head>
  <meta charset="utf-8">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${metaTags}
  ${AMP_BOILERPLATE}
  <style amp-custom>
${generateAmpCss()}
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;700&display=swap" rel="stylesheet">
  ${jsonLd}
</head>
<body>
  <article>
    <header>
      <h1>${escapeHtml(entry.title)}</h1>
      <time datetime="${new Date(entry.date).toISOString()}">${dateStr}</time>
      ${tagsHtml}
    </header>
    <div class="prose">
      ${content}
    </div>
    <footer>
      <p><a href="${escapeHtml(config.siteUrl)}/">${escapeHtml(config.siteTitle)}</a></p>
    </footer>
  </article>
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
