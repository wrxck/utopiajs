/**
 * Attributes for a <meta> element.
 *
 * Supports `name`/`content`, `property`/`content` (OpenGraph),
 * `httpEquiv`/`content`, and `charset`.
 */
export interface MetaDescriptor {
  name?: string;
  property?: string;
  httpEquiv?: string;
  content?: string;
  charset?: string;
}

/**
 * Attributes for a <link> element.
 *
 * Covers common use cases: stylesheets, icons, preload/prefetch,
 * canonical links, and RSS/Atom feeds.
 */
export interface LinkDescriptor {
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
  media?: string;
  color?: string;
  crossorigin?: string;
  as?: string;
  title?: string;
}

/**
 * Complete head configuration for a page or component.
 *
 * All fields are optional — only provided fields are applied.
 */
export interface HeadConfig {
  /** Document title. */
  title?: string;
  /** Title template — use `%s` as placeholder for the page title. */
  titleTemplate?: string;
  /** Meta tags. */
  meta?: MetaDescriptor[];
  /** Link tags. */
  link?: LinkDescriptor[];
  /** The `lang` attribute on <html>. */
  htmlLang?: string;
  /** The `dir` attribute on <html>. */
  htmlDir?: 'ltr' | 'rtl' | 'auto';
  /** Theme color for mobile browsers. */
  themeColor?: string;
}

/**
 * Favicon configuration for generating all icon variants.
 */
export interface FaviconConfig {
  /** The SVG source for the favicon. */
  svg: string;
  /** Background color for icon variants (default: '#ffffff'). */
  backgroundColor?: string;
  /** Foreground/icon color (default: '#000000'). */
  foregroundColor?: string;
  /** Theme color for the web manifest (default: backgroundColor). */
  themeColor?: string;
  /** App name for the web manifest. */
  appName?: string;
}
