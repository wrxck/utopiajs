import matter from 'gray-matter';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

/** keys that must never appear as own properties of parsed frontmatter. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * recursively remove prototype-pollution keys from a parsed value. yaml can
 * carry an own `__proto__` key which would graduate to real pollution once a
 * downstream consumer deep-merges the data, so strip them at the boundary.
 */
function stripDangerousKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripDangerousKeys(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (DANGEROUS_KEYS.has(key)) {
        delete obj[key];
      } else {
        stripDangerousKeys(obj[key]);
      }
    }
  }
}

/**
 * Extract YAML frontmatter and body from a markdown string.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const result = matter(content);
  const data = result.data as Record<string, unknown>;
  stripDangerousKeys(data);
  return {
    data,
    body: result.content,
  };
}

/**
 * Serialize frontmatter data and body back to a markdown string with YAML frontmatter.
 */
export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = matter.stringify(body, data);
  return yaml;
}
