import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ContentAdapter, CollectionConfig, ContentEntry, ContentFormat } from '../types.js';
import { parseFrontmatter, serializeFrontmatter } from '../frontmatter.js';
import { renderMarkdown } from '../markdown.js';

/** Slug must start with alphanumeric, then allow alphanumeric, hyphens, underscores, and slashes. */
export const VALID_SLUG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_/-]*$/;

export function validateSlug(slug: string): void {
  if (!slug || !VALID_SLUG_RE.test(slug) || slug.includes('..') || slug.includes('//')) {
    throw new Error(`Invalid slug: ${JSON.stringify(slug)}`);
  }
}

const FORMAT_EXTENSIONS: Record<string, ContentFormat> = {
  '.md': 'md',
  '.utopia': 'utopia',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

const FORMAT_EXT_MAP: Record<ContentFormat, string> = {
  md: '.md',
  utopia: '.utopia',
  json: '.json',
  yaml: '.yaml',
};

function slugFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

function isAllowedFormat(ext: string, formats?: ContentFormat[]): boolean {
  const format = FORMAT_EXTENSIONS[ext];
  if (!format) return false;
  if (!formats || formats.length === 0) return true;
  return formats.includes(format);
}

export function createFilesystemAdapter(baseDir?: string): ContentAdapter {
  function resolveDir(config: CollectionConfig): string {
    return baseDir ? resolve(baseDir, config.directory) : resolve(config.directory);
  }

  async function parseFile(filePath: string, collection: string): Promise<ContentEntry> {
    const ext = extname(filePath);
    const format = FORMAT_EXTENSIONS[ext]!;
    const slug = slugFromFilename(filePath);
    const raw = await readFile(filePath, 'utf-8');

    switch (format) {
      case 'md': {
        const { data, body } = parseFrontmatter(raw);
        const html = await renderMarkdown(body);
        return { slug, collection, data, body, html, format, filePath };
      }
      case 'utopia': {
        // Extract metadata export from script block
        const data = extractUtopiaMetadata(raw);
        return { slug, collection, data, body: raw, format, filePath };
      }
      case 'json': {
        const data = JSON.parse(raw);
        return { slug, collection, data, body: raw, format, filePath };
      }
      case 'yaml': {
        const { data } = parseFrontmatter(`---\n${raw}\n---\n`);
        return { slug, collection, data, body: raw, format, filePath };
      }
    }
  }

  return {
    async readEntries(config: CollectionConfig): Promise<ContentEntry[]> {
      const dir = resolveDir(config);
      if (!existsSync(dir)) return [];

      const files = await readdir(dir);
      const entries: ContentEntry[] = [];

      for (const file of files) {
        const ext = extname(file);
        if (!isAllowedFormat(ext, config.formats)) continue;

        const filePath = join(dir, file);
        entries.push(await parseFile(filePath, config.name));
      }

      return entries;
    },

    async readEntry(config: CollectionConfig, slug: string): Promise<ContentEntry | null> {
      validateSlug(slug);
      const dir = resolveDir(config);
      const formats = config.formats ?? (['md', 'utopia', 'json', 'yaml'] as ContentFormat[]);

      for (const format of formats) {
        const filePath = join(dir, `${slug}${FORMAT_EXT_MAP[format]}`);
        const resolved = resolve(filePath);
        if (!resolved.startsWith(resolve(dir))) throw new Error('Path traversal detected');
        if (existsSync(filePath)) {
          return parseFile(filePath, config.name);
        }
      }

      return null;
    },

    async writeEntry(
      config: CollectionConfig,
      slug: string,
      data: Record<string, unknown>,
      body: string,
      format: ContentFormat = 'md',
    ): Promise<void> {
      validateSlug(slug);
      const dir = resolveDir(config);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const filePath = join(dir, `${slug}${FORMAT_EXT_MAP[format]}`);
      const resolved = resolve(filePath);
      if (!resolved.startsWith(resolve(dir))) throw new Error('Path traversal detected');

      switch (format) {
        case 'md': {
          const content = serializeFrontmatter(data, body);
          await writeFile(filePath, content, 'utf-8');
          break;
        }
        case 'json': {
          await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
          break;
        }
        case 'yaml': {
          // Serialize as frontmatter then strip the --- delimiters and trailing body
          const frontmattered = serializeFrontmatter(data, '');
          const yamlContent = frontmattered.replace(/^---\n/, '').replace(/\n---\n[\s\S]*$/, '');
          await writeFile(filePath, yamlContent + '\n', 'utf-8');
          break;
        }
        default: {
          await writeFile(filePath, body, 'utf-8');
        }
      }
    },

    async updateEntry(
      config: CollectionConfig,
      slug: string,
      data?: Record<string, unknown>,
      body?: string,
    ): Promise<void> {
      const existing = await this.readEntry(config, slug);
      if (!existing) {
        throw new Error(`Entry "${slug}" not found in collection "${config.name}"`);
      }

      const newData = data ? { ...existing.data, ...data } : existing.data;
      const newBody = body ?? existing.body;
      await this.writeEntry(config, slug, newData, newBody, existing.format);
    },

    async deleteEntry(config: CollectionConfig, slug: string): Promise<void> {
      const existing = await this.readEntry(config, slug);
      if (!existing) {
        throw new Error(`Entry "${slug}" not found in collection "${config.name}"`);
      }
      await unlink(existing.filePath);
    },

    async listSlugs(config: CollectionConfig): Promise<string[]> {
      const dir = resolveDir(config);
      if (!existsSync(dir)) return [];

      const files = await readdir(dir);
      return files
        .filter((f) => isAllowedFormat(extname(f), config.formats))
        .map((f) => slugFromFilename(f));
    },
  };
}

/**
 * Extract metadata from a .utopia file's script block.
 * Looks for `export const metadata = { ... }` pattern.
 */
function extractUtopiaMetadata(source: string): Record<string, unknown> {
  const scriptMatch = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return {};

  const script = scriptMatch[1];
  const metadataMatch = script.match(/export\s+const\s+metadata\s*=\s*(\{[\s\S]*?\});/);
  if (!metadataMatch) return {};

  try {
    return JSON.parse(metadataMatch[1]) as Record<string, unknown>;
  } catch {
    return {};
  }
}
