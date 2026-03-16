import matter from 'gray-matter';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

/**
 * Extract YAML frontmatter and body from a markdown string.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const result = matter(content);
  return {
    data: result.data as Record<string, unknown>,
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
