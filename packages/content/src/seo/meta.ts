import type { SeoConfig, SeoEntry } from './types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Generate <meta> and JSON-LD tags for a blog post */
export function generateMetaTags(entry: SeoEntry, config: SeoConfig): string {
  const url = `${config.siteUrl}/${config.routePrefix ?? 'blog'}/${entry.slug}`;
  const ogImageUrl = `${config.siteUrl}/og/${entry.slug}.png`;
  const ampUrl = `${config.siteUrl}/amp/${config.routePrefix ?? 'blog'}/${entry.slug}`;
  const locale = config.locale ?? 'en_GB';

  const lines: string[] = [
    `<title>${escapeHtml(entry.title)} — ${escapeHtml(config.siteTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(entry.description ?? '')}">`,
    `<meta name="robots" content="index, follow">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<link rel="amphtml" href="${escapeHtml(ampUrl)}">`,
    // OG
    `<meta property="og:title" content="${escapeHtml(entry.title)}">`,
    `<meta property="og:description" content="${escapeHtml(entry.description ?? '')}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:locale" content="${locale}">`,
    `<meta property="og:site_name" content="${escapeHtml(config.siteTitle)}">`,
    // Article
    `<meta property="article:published_time" content="${new Date(entry.date).toISOString()}">`,
  ];

  if (config.author) {
    lines.push(`<meta property="article:author" content="${escapeHtml(config.author.name)}">`);
  }

  if (entry.tags) {
    for (const tag of entry.tags) {
      lines.push(`<meta property="article:tag" content="${escapeHtml(tag)}">`);
    }
  }

  // Twitter
  lines.push(
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(entry.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(entry.description ?? '')}">`,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">`,
  );

  return lines.join('\n  ');
}

/** Generate JSON-LD BlogPosting structured data */
export function generateJsonLd(entry: SeoEntry, config: SeoConfig): string {
  const url = `${config.siteUrl}/${config.routePrefix ?? 'blog'}/${entry.slug}`;
  const ogImageUrl = `${config.siteUrl}/og/${entry.slug}.png`;

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: entry.title,
    url,
    datePublished: new Date(entry.date).toISOString(),
    image: entry.image ? `${config.siteUrl}/${entry.image}` : ogImageUrl,
  };

  if (entry.description) {
    ld.description = entry.description;
  }

  if (config.author) {
    ld.author = {
      '@type': 'Person',
      name: config.author.name,
      ...(config.author.url ? { url: config.author.url } : {}),
    };
  }

  ld.publisher = {
    '@type': 'Person',
    name: config.author?.name ?? config.siteTitle,
  };

  if (entry.tags) {
    ld.keywords = entry.tags.join(', ');
  }

  return `<script type="application/ld+json">\n  ${JSON.stringify(ld)}\n  </script>`;
}
