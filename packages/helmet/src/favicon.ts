import type { LinkDescriptor, FaviconConfig } from './types.js';

// ---------------------------------------------------------------------------
// SVG favicon generation
// ---------------------------------------------------------------------------

/**
 * Generate an SVG favicon string with a centered character on a rounded
 * rectangle background. Supports dark mode via `prefers-color-scheme`.
 *
 * @param char - The character(s) to display (e.g. 'M')
 * @param options - Customization options
 * @returns SVG string
 *
 * @example
 * ```ts
 * const svg = generateFaviconSvg('M', {
 *   fontFamily: "'DM Mono', monospace",
 *   bg: '#ffffff',
 *   fg: '#000000',
 *   darkBg: '#000000',
 *   darkFg: '#ffffff',
 *   radius: 12,
 * });
 * ```
 */
export function generateFaviconSvg(
  char: string,
  options: {
    fontFamily?: string;
    bg?: string;
    fg?: string;
    darkBg?: string;
    darkFg?: string;
    radius?: number;
    size?: number;
    fontSize?: number;
  } = {},
): string {
  const {
    fontFamily = "'DM Mono', monospace",
    bg = '#ffffff',
    fg = '#000000',
    darkBg = '#000000',
    darkFg = '#ffffff',
    radius = 12,
    size = 100,
    fontSize = 62,
  } = options;

  const half = size / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<style>`,
    `  rect { fill: ${bg}; }`,
    `  text { fill: ${fg}; }`,
    `  @media (prefers-color-scheme: dark) {`,
    `    rect { fill: ${darkBg}; }`,
    `    text { fill: ${darkFg}; }`,
    `  }`,
    `</style>`,
    `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" />`,
    `<text x="${half}" y="${half}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="400" text-anchor="middle" dominant-baseline="central">${char}</text>`,
    `</svg>`,
  ].join('');
}

/**
 * Generate a static (non-adaptive) SVG for use as Apple touch icon or
 * other contexts that don't support CSS media queries.
 *
 * @param char - Character to display
 * @param options - Customization (bg, fg, font, etc.)
 * @returns SVG string (no dark mode)
 */
export function generateStaticSvg(
  char: string,
  options: {
    fontFamily?: string;
    bg?: string;
    fg?: string;
    radius?: number;
    size?: number;
    fontSize?: number;
  } = {},
): string {
  const {
    fontFamily = "'DM Mono', monospace",
    bg = '#ffffff',
    fg = '#000000',
    radius = 0,
    size = 100,
    fontSize = 62,
  } = options;

  const half = size / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${bg}" />`,
    `<text x="${half}" y="${half}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="400" text-anchor="middle" dominant-baseline="central" fill="${fg}">${char}</text>`,
    `</svg>`,
  ].join('');
}

/**
 * Generate an SVG mask icon (monochrome, no background) for Safari
 * pinned tabs and similar contexts.
 *
 * @param char - Character to display
 * @param options - Font and size options
 * @returns Monochrome SVG string
 */
export function generateMaskSvg(
  char: string,
  options: {
    fontFamily?: string;
    size?: number;
    fontSize?: number;
  } = {},
): string {
  const {
    fontFamily = "'DM Mono', monospace",
    size = 100,
    fontSize = 62,
  } = options;

  const half = size / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<text x="${half}" y="${half}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="400" text-anchor="middle" dominant-baseline="central" fill="#000000">${char}</text>`,
    `</svg>`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Web manifest generation
// ---------------------------------------------------------------------------

/**
 * Icon entry in a web app manifest.
 */
export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

/**
 * Web app manifest structure (subset of fields relevant to icons).
 */
export interface WebManifest {
  name: string;
  short_name?: string;
  icons: ManifestIcon[];
  theme_color: string;
  background_color: string;
  display: string;
}

/**
 * Generate a web app manifest object for the given favicon config.
 *
 * @param config - Favicon configuration
 * @returns WebManifest object (serialize with JSON.stringify)
 */
export function generateManifest(config: {
  appName: string;
  shortName?: string;
  themeColor?: string;
  backgroundColor?: string;
  iconPath?: string;
}): WebManifest {
  const {
    appName,
    shortName,
    themeColor = '#ffffff',
    backgroundColor = '#ffffff',
    iconPath = '/icons',
  } = config;

  return {
    name: appName,
    short_name: shortName ?? appName,
    icons: [
      { src: `${iconPath}/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${iconPath}/icon-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `${iconPath}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    theme_color: themeColor,
    background_color: backgroundColor,
    display: 'standalone',
  };
}

// ---------------------------------------------------------------------------
// Head link tags for favicon integration
// ---------------------------------------------------------------------------

/**
 * Generate the complete set of `<link>` descriptors for a favicon setup.
 *
 * This produces links for:
 * - SVG favicon (adaptive dark mode)
 * - Apple touch icon (180x180)
 * - Web manifest
 * - Safari mask icon
 * - Standard 32x32 and 16x16 favicons
 *
 * @param options - Paths and colors
 * @returns Array of LinkDescriptor for use with setLink() or setHead()
 *
 * @example
 * ```ts
 * const links = faviconLinks({
 *   svgPath: '/favicon.svg',
 *   appleTouchPath: '/apple-touch-icon.png',
 *   manifestPath: '/site.webmanifest',
 *   maskPath: '/mask-icon.svg',
 *   maskColor: '#000000',
 *   icon32Path: '/favicon-32x32.png',
 *   icon16Path: '/favicon-16x16.png',
 * });
 *
 * setHead({ link: links });
 * ```
 */
export function faviconLinks(options: {
  svgPath?: string;
  appleTouchPath?: string;
  manifestPath?: string;
  maskPath?: string;
  maskColor?: string;
  icon32Path?: string;
  icon16Path?: string;
}): LinkDescriptor[] {
  const {
    svgPath = '/favicon.svg',
    appleTouchPath = '/apple-touch-icon.png',
    manifestPath = '/site.webmanifest',
    maskPath = '/mask-icon.svg',
    maskColor = '#000000',
    icon32Path = '/favicon-32x32.png',
    icon16Path = '/favicon-16x16.png',
  } = options;

  const links: LinkDescriptor[] = [
    { rel: 'icon', href: svgPath, type: 'image/svg+xml' },
    { rel: 'icon', href: icon32Path, type: 'image/png', sizes: '32x32' },
    { rel: 'icon', href: icon16Path, type: 'image/png', sizes: '16x16' },
    { rel: 'apple-touch-icon', href: appleTouchPath, sizes: '180x180' },
    { rel: 'manifest', href: manifestPath },
    { rel: 'mask-icon', href: maskPath, color: maskColor },
  ];

  return links;
}
