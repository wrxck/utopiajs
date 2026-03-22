import type { SeoConfig, SeoEntry } from './types.js';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Generate sitemap.xml for all blog entries */
export function generateSitemap(entries: SeoEntry[], config: SeoConfig): string {
  const prefix = config.routePrefix ?? 'blog';
  const urls = entries.map((entry) => {
    const loc = `${config.siteUrl}/${prefix}/${entry.slug}`;
    const lastmod = new Date(entry.date).toISOString().split('T')[0];
    return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`;
  });

  // Add home page
  urls.unshift(`  <url>
    <loc>${escapeXml(config.siteUrl)}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}
