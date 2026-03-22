import type { SeoConfig } from './types.js';

/** Generate robots.txt with sitemap reference */
export function generateRobots(config: SeoConfig): string {
  return `User-agent: *
Allow: /

Sitemap: ${config.siteUrl}/sitemap.xml`;
}
