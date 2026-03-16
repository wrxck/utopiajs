// ============================================================================
// @matthesketh/utopia-server — API route handler
// ============================================================================
//
// Handles SvelteKit-style +server.ts API routes. Each module exports HTTP
// method handlers (GET, POST, PUT, PATCH, DELETE, etc.) that receive a
// RequestEvent and return a Response.
// ============================================================================

import { filePathToRoute, compilePattern } from '@matthesketh/utopia-router';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestEvent {
  request: Request;
  url: URL;
  params: Record<string, string>;
}

export type RequestHandler = (event: RequestEvent) => Response | Promise<Response>;

interface ApiRoute {
  path: string;
  pattern: RegExp;
  params: string[];
  module: () => Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/** Matches +server file in a path. */
const SERVER_FILE_RE = /\+server\.\w+$/;

/** Allowed HTTP methods for API routes. */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// ---------------------------------------------------------------------------
// buildApiRoutes
// ---------------------------------------------------------------------------

/**
 * Build an ordered API route table from a Vite glob manifest.
 *
 * @param manifest - Record of file paths to lazy import functions, filtered
 *                   to +server.ts files.
 */
export function buildApiRoutes(
  manifest: Record<string, () => Promise<Record<string, unknown>>>,
): ApiRoute[] {
  const routes: ApiRoute[] = [];

  for (const [filePath, importFn] of Object.entries(manifest)) {
    // Convert +server.ts path to a URL pattern.
    // filePathToRoute strips +page, so we need to handle +server ourselves.
    const normalized = filePath.replace(/\\/g, '/');
    if (!SERVER_FILE_RE.test(normalized)) continue;

    // Strip the +server.ext suffix to get the directory path,
    // then convert using the same logic as page routes.
    const dirPath = normalized.replace(SERVER_FILE_RE, '+page.utopia');
    const path = filePathToRoute(dirPath);
    const { regex, params } = compilePattern(path);

    routes.push({ path, pattern: regex, params, module: importFn });
  }

  return routes;
}

// ---------------------------------------------------------------------------
// handleApiRequest
// ---------------------------------------------------------------------------

/**
 * Match an incoming request against API routes and dispatch to the
 * appropriate handler.
 *
 * @returns A Response if a route matched, or null if no API route matches.
 */
export async function handleApiRequest(
  url: URL,
  method: string,
  request: Request,
  routes: ApiRoute[],
): Promise<Response | null> {
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  for (const route of routes) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;

    const params: Record<string, string> = {};
    for (let i = 0; i < route.params.length; i++) {
      params[route.params[i]] = decodeURIComponent(match[i + 1]);
    }

    const mod = await route.module();
    const handler = mod[method] as RequestHandler | undefined;

    if (!handler) {
      // Route matched but method not exported — return 405.
      const allowed = Object.keys(mod)
        .filter((k) => HTTP_METHODS.has(k))
        .join(', ');
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: allowed },
      });
    }

    const event: RequestEvent = { request, url, params };
    return handler(event);
  }

  return null;
}
