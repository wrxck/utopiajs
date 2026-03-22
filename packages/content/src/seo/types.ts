/** SEO entry derived from collected content entries */
export interface SeoEntry {
  slug: string;
  title: string;
  description?: string;
  date: string;
  tags?: string[];
  html?: string;
  image?: string;
}

/** OG image customisation */
export interface OgImageConfig {
  /** Path to logo SVG (inlined into the template) */
  logo?: string;
  /** Background colour (default: '#000000') */
  background?: string;
  /** Text colour (default: '#ffffff') */
  textColor?: string;
}

/** SEO plugin configuration */
export interface SeoConfig {
  /** Canonical site URL (defaults from feed.siteUrl) */
  siteUrl: string;
  /** Site title (defaults from feed.title) */
  siteTitle: string;
  /** Site description (defaults from feed.description) */
  siteDescription: string;
  /** Author info */
  author?: { name: string; url?: string };
  /** OG locale (default: 'en_GB') */
  locale?: string;
  /** Content collection name (default: 'blog') */
  collection?: string;
  /** Filter out drafts (default: true) */
  filterDrafts?: boolean;
  /** URL path prefix for posts (default: 'blog') */
  routePrefix?: string;
  /** Enable AMP pages (default: true) */
  amp?: boolean;
  /** Enable sitemap (default: true) */
  sitemap?: boolean;
  /** Enable robots.txt (default: true) */
  robots?: boolean;
  /** Enable OG image generation (default: true) */
  ogImage?: boolean | OgImageConfig;
}

/** User-facing config (all optional, derived from feed) */
export type SeoOptions = Partial<SeoConfig>;
