// ============================================================================
// @matthesketh/utopia-router — Route matching and file-system convention mapping
// ============================================================================
//
// SvelteKit-style file-based routing:
//
//   src/routes/+page.utopia              → /
//   src/routes/about/+page.utopia        → /about
//   src/routes/blog/[slug]/+page.utopia  → /blog/:slug
//   src/routes/[...rest]/+page.utopia    → /*rest          (catch-all)
//   src/routes/+layout.utopia            → layout wrapper
//   src/routes/+error.utopia             → error boundary
//   src/routes/(group)/+page.utopia      → /               (route group, invisible in URL)
//
// ============================================================================

import type { Route, RouteMatch } from './types.js';

// ---------------------------------------------------------------------------
// filePathToRoute — Convert a file path to a URL route pattern
// ---------------------------------------------------------------------------

/**
 * Converts a file-system path (relative to the routes directory) into a URL
 * route pattern.
 *
 * @param filePath - File path like 'src/routes/blog/[slug]/+page.utopia'
 * @returns URL pattern like '/blog/:slug'
 *
 * @example
 * filePathToRoute('src/routes/+page.utopia')             // '/'
 * filePathToRoute('src/routes/about/+page.utopia')       // '/about'
 * filePathToRoute('src/routes/blog/[slug]/+page.utopia') // '/blog/:slug'
 * filePathToRoute('src/routes/[...rest]/+page.utopia')   // '/*rest'
 * filePathToRoute('src/routes/(auth)/login/+page.utopia') // '/login'
 */
export function filePathToRoute(filePath: string): string {
  // Normalize separators to forward slashes.
  let normalized = filePath.replace(/\\/g, '/');

  // Strip the leading routes directory prefix.
  // Accept both 'src/routes/' and just 'routes/' or a bare path with +page.
  const routesIdx = normalized.indexOf('routes/');
  if (routesIdx !== -1) {
    normalized = normalized.slice(routesIdx + 'routes/'.length);
  }

  // Remove the +page.utopia (or +page.ts, +page.js, etc.) filename at the end.
  normalized = normalized.replace(/\/?\+page\.\w+$/, '');

  // Remove the +layout.utopia or +error.utopia filenames.
  normalized = normalized.replace(/\/?\+(layout|error)\.\w+$/, '');

  // Split into segments and process each one.
  const segments = normalized.split('/').filter(Boolean);
  const routeSegments: string[] = [];

  for (const segment of segments) {
    // Route groups: (groupName) — stripped from URL.
    if (/^\(.+\)$/.test(segment)) {
      continue;
    }

    // Catch-all: [...paramName]
    if (/^\[\.\.\..+\]$/.test(segment)) {
      const paramName = segment.slice(4, -1); // strip '[...' and ']'
      routeSegments.push(`*${paramName}`);
      continue;
    }

    // Dynamic parameter: [paramName]
    if (/^\[.+\]$/.test(segment)) {
      const paramName = segment.slice(1, -1); // strip '[' and ']'
      routeSegments.push(`:${paramName}`);
      continue;
    }

    // Static segment — pass through as-is.
    routeSegments.push(segment);
  }

  const path = '/' + routeSegments.join('/');
  return path;
}

// ---------------------------------------------------------------------------
// compilePattern — Compile a route pattern to regex + param names
// ---------------------------------------------------------------------------

/**
 * Compiles a URL route pattern into a regex and extracts parameter names.
 *
 * @param pattern - Route pattern like '/blog/:slug' or '/*rest'
 * @returns Object with `regex` and `params` array
 *
 * @example
 * compilePattern('/blog/:slug')
 * // { regex: /^\/blog\/([^/]+)\/?$/, params: ['slug'] }
 *
 * compilePattern('/*rest')
 * // { regex: /^\/(.+)\/?$/, params: ['rest'] }
 */
export function compilePattern(pattern: string): { regex: RegExp; params: string[] } {
  const params: string[] = [];

  // Handle root route.
  if (pattern === '/') {
    return {
      regex: /^\/$/,
      params: [],
    };
  }

  const segments = pattern.split('/').filter(Boolean);
  let regexStr = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (segment.startsWith('*')) {
      // Catch-all parameter — matches one or more path segments.
      const paramName = segment.slice(1);
      params.push(paramName);
      regexStr += '/(.+)';
    } else if (segment.startsWith(':')) {
      // Dynamic parameter — matches a single path segment.
      const paramName = segment.slice(1);
      params.push(paramName);
      regexStr += '/([^/]+)';
    } else {
      // Static segment.
      regexStr += '/' + escapeRegex(segment);
    }
  }

  // Allow optional trailing slash.
  regexStr = '^' + regexStr + '/?$';

  return {
    regex: new RegExp(regexStr),
    params,
  };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// matchRoute — Match a URL against a list of routes
// ---------------------------------------------------------------------------

/**
 * Matches a URL against an ordered list of routes. Returns the first match
 * with extracted parameters, or null if no route matches.
 *
 * Routes are tested in order, so more specific routes should come first.
 * The `buildRouteTable` function handles this ordering automatically.
 *
 * @param url - The URL to match
 * @param routes - Ordered array of compiled routes
 * @returns The matched route with params, or null
 */
export function matchRoute(url: URL, routes: Route[]): RouteMatch | null {
  // Normalize: strip trailing slash (except for root '/').
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < route.params.length; i++) {
        params[route.params[i]] = decodeURIComponent(match[i + 1]);
      }
      return { route, params, url };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildRouteTable — Build a route table from a file system manifest
// ---------------------------------------------------------------------------

/**
 * Builds an ordered route table from a Vite-style glob import manifest.
 *
 * The manifest maps file paths to lazy import functions, e.g.:
 * ```ts
 * {
 *   'src/routes/+page.utopia': () => import('./routes/+page.utopia'),
 *   'src/routes/about/+page.utopia': () => import('./routes/about/+page.utopia'),
 *   'src/routes/blog/[slug]/+page.utopia': () => import('./routes/blog/[slug]/+page.utopia'),
 *   'src/routes/+layout.utopia': () => import('./routes/+layout.utopia'),
 *   'src/routes/+error.utopia': () => import('./routes/+error.utopia'),
 * }
 * ```
 *
 * Routes are sorted so that:
 * 1. Static routes come before dynamic routes
 * 2. Dynamic parameter routes come before catch-all routes
 * 3. More specific routes (more static segments) come first
 *
 * @param manifest - Record of file paths to lazy import functions
 * @returns Ordered array of compiled Route objects
 */
export function buildRouteTable(
  manifest: Record<string, () => Promise<Record<string, unknown>>>,
): Route[] {
  const pages: Map<string, () => Promise<Record<string, unknown>>> = new Map();
  const layouts: Map<string, () => Promise<Record<string, unknown>>> = new Map();
  const errors: Map<string, () => Promise<Record<string, unknown>>> = new Map();

  // Classify each manifest entry.
  for (const [filePath, importFn] of Object.entries(manifest)) {
    const normalized = filePath.replace(/\\/g, '/');

    if (/\+page\.\w+$/.test(normalized)) {
      pages.set(normalized, importFn);
    } else if (/\+layout\.\w+$/.test(normalized)) {
      layouts.set(normalized, importFn);
    } else if (/\+error\.\w+$/.test(normalized)) {
      errors.set(normalized, importFn);
    }
  }

  // Build routes from pages.
  const routes: Route[] = [];

  for (const [filePath, importFn] of pages) {
    const path = filePathToRoute(filePath);
    const { regex, params } = compilePattern(path);

    // Find the nearest layout and error boundary by walking up the directory tree.
    const layout = findNearestSpecialFile(filePath, layouts);
    const error = findNearestSpecialFile(filePath, errors);

    routes.push({
      path,
      pattern: regex,
      params,
      component: importFn,
      layout,
      error,
    });
  }

  // Sort routes by specificity:
  // 1. Static segments are more specific than dynamic ones
  // 2. Dynamic params (:param) are more specific than catch-alls (*rest)
  // 3. Longer paths (more segments) are more specific when all else is equal
  routes.sort((a, b) => {
    const scoreA = routeSpecificity(a.path);
    const scoreB = routeSpecificity(b.path);

    // Higher score = more specific = should come first.
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }

    // Tie-break by alphabetical order for determinism.
    return a.path.localeCompare(b.path);
  });

  return routes;
}

/**
 * Calculate a specificity score for a route path. Higher = more specific.
 *
 * Scoring:
 * - Each static segment: +3
 * - Each dynamic param segment (:param): +2
 * - Each catch-all segment (*rest): +1
 * - Base score from segment count to prefer longer exact matches
 */
function routeSpecificity(path: string): number {
  if (path === '/') {
    return 10; // Root is maximally specific for its own URL.
  }

  const segments = path.split('/').filter(Boolean);
  let score = 0;

  for (const segment of segments) {
    if (segment.startsWith('*')) {
      score += 1;
    } else if (segment.startsWith(':')) {
      score += 2;
    } else {
      score += 3;
    }
  }

  return score;
}

/**
 * Find the nearest layout or error file for a given page file path.
 *
 * Walks up from the page's directory, looking for a matching special file
 * in the same directory or any ancestor up to the routes root.
 *
 * @param pageFilePath - The page file path, e.g., 'src/routes/blog/[slug]/+page.utopia'
 * @param specialFiles - Map of special file paths to their import functions
 * @returns The import function for the nearest matching file, or undefined
 */
function findNearestSpecialFile(
  pageFilePath: string,
  specialFiles: Map<string, () => Promise<Record<string, unknown>>>,
): (() => Promise<Record<string, unknown>>) | undefined {
  const normalized = pageFilePath.replace(/\\/g, '/');

  // Get the directory of the page file.
  const lastSlash = normalized.lastIndexOf('/');
  let dir = lastSlash !== -1 ? normalized.slice(0, lastSlash) : '';

  // Walk up directories looking for a matching special file.
  while (dir) {
    for (const [specialPath, importFn] of specialFiles) {
      const specialNorm = specialPath.replace(/\\/g, '/');
      const specialLastSlash = specialNorm.lastIndexOf('/');
      const specialDir = specialLastSlash !== -1 ? specialNorm.slice(0, specialLastSlash) : '';

      if (specialDir === dir) {
        return importFn;
      }
    }

    // Move up one directory.
    const parentSlash = dir.lastIndexOf('/');
    if (parentSlash === -1) {
      break;
    }
    dir = dir.slice(0, parentSlash);
  }

  return undefined;
}
