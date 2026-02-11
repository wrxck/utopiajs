// ============================================================================
// @matthesketh/utopia-router — Query & route parameter utilities
// ============================================================================

import { computed } from '@matthesketh/utopia-core';
import { currentRoute, navigate } from './router.js';

/**
 * Reactive computed signal returning all current query parameters as a plain object.
 */
export const queryParams = computed<Record<string, string>>(() => {
  const match = currentRoute();
  if (!match) return {};
  const result: Record<string, string> = {};
  match.url.searchParams.forEach((value, key) => {
    result[key] = value;
  });
  return result;
});

/**
 * Returns a computed signal for a specific query parameter.
 * Returns null if the parameter is not present.
 */
export function getQueryParam(name: string) {
  return computed<string | null>(() => {
    const match = currentRoute();
    if (!match) return null;
    return match.url.searchParams.get(name);
  });
}

/**
 * Update a single query parameter and navigate (replace mode).
 * Pass null to remove the parameter.
 */
export function setQueryParam(name: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (value === null) {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  navigate(url.pathname + url.search + url.hash, { replace: true });
}

/**
 * Update multiple query parameters in a single navigation.
 * Pass null for a value to remove that parameter.
 */
export function setQueryParams(params: Record<string, string | null>): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  navigate(url.pathname + url.search + url.hash, { replace: true });
}

/**
 * Returns a computed signal for a specific route path parameter.
 * Returns null if the parameter is not present.
 */
export function getRouteParam(name: string) {
  return computed<string | null>(() => {
    const match = currentRoute();
    if (!match) return null;
    return match.params[name] ?? null;
  });
}
