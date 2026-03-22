import type { Plugin } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseFrontmatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { generateRssFeed, generateAtomFeed } from './feed.js';
import type { FeedOptions } from './feed.js';

export interface ContentPluginOptions {
  /** Base directory for content files (default: 'content') */
  contentDir?: string;
  /** Embed rendered HTML for markdown entries in the virtual module */
  embedHtml?: boolean;
  /** Embed raw markdown body in the virtual module */
  embedBody?: boolean;
  /** Markdown rendering options */
  markdown?: {
    highlight?: boolean;
  };
  /** Generate RSS/Atom feeds at build time */
  feed?: FeedOptions & {
    /** Collection to generate feeds from (default: 'blog') */
    collection?: string;
    /** Filter out draft entries (default: true) */
    filterDrafts?: boolean;
  };
}

/** Virtual module ID for content manifest */
const VIRTUAL_MODULE_ID = 'virtual:utopia-content';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

const CONTENT_EXTENSIONS = new Set(['.md', '.utopia', '.json', '.yaml', '.yml']);

/**
 * Vite plugin for UtopiaJS content.
 *
 * Watches the content directory for changes, generates a virtual module
 * with content metadata, and triggers HMR on content file changes.
 *
 * ```ts
 * import utopia from '@matthesketh/utopia-vite-plugin';
 * import content from '@matthesketh/utopia-content/vite';
 *
 * export default {
 *   plugins: [
 *     utopia(),
 *     content({ contentDir: 'content', embedHtml: true }),
 *   ],
 * };
 * ```
 */
export default function contentPlugin(options: ContentPluginOptions = {}): Plugin {
  const contentDir = options.contentDir ?? 'content';
  const embedHtml = options.embedHtml ?? false;
  const embedBody = options.embedBody ?? false;
  let resolvedContentDir: string;
  let collectedEntries: CollectedEntries = {};

  return {
    name: 'utopia-content',

    configResolved(config) {
      resolvedContentDir = resolve(config.root, contentDir);
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
    },

    async load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const result = await generateManifestModule(resolvedContentDir, {
          embedHtml,
          embedBody,
          highlight: options.markdown?.highlight,
        });
        collectedEntries = result.entries;
        return result.code;
      }
    },

    configureServer(server) {
      // Watch the content directory for changes
      if (existsSync(resolvedContentDir)) {
        server.watcher.add(resolvedContentDir);
      }

      server.watcher.on('all', (event, filePath) => {
        if (!filePath.startsWith(resolvedContentDir)) return;
        if (!CONTENT_EXTENSIONS.has(extname(filePath))) return;

        // Invalidate the virtual module to regenerate the manifest
        const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }
      });
    },

    handleHotUpdate({ file }) {
      if (!file.startsWith(resolvedContentDir)) return;
      if (!CONTENT_EXTENSIONS.has(extname(file))) return;
      return [];
    },

    generateBundle() {
      if (!options.feed) return;

      const feedOpts = options.feed;
      const collectionName = feedOpts.collection ?? 'blog';
      const filterDrafts = feedOpts.filterDrafts ?? true;

      const entries = collectedEntries[collectionName];
      if (!entries || entries.length === 0) return;

      const feedEntries = entries
        .filter((e) => !filterDrafts || !e.data.draft)
        .sort((a, b) => {
          const da = new Date(a.data.date as string).getTime();
          const db = new Date(b.data.date as string).getTime();
          return db - da;
        })
        .map((e) => ({
          slug: e.slug,
          title: (e.data.title as string) ?? e.slug,
          description: e.data.description as string | undefined,
          date: (e.data.date as string) ?? new Date().toISOString(),
          html: e.html,
          url: `${feedOpts.siteUrl}/blog/${e.slug}`,
          tags: e.data.tags as string[] | undefined,
        }));

      const rssFeedUrl = feedOpts.feedUrl ?? `${feedOpts.siteUrl}/feed.xml`;
      const atomFeedUrl = `${feedOpts.siteUrl}/atom.xml`;

      this.emitFile({
        type: 'asset',
        fileName: 'feed.xml',
        source: generateRssFeed(feedEntries, { ...feedOpts, feedUrl: rssFeedUrl }),
      });

      this.emitFile({
        type: 'asset',
        fileName: 'atom.xml',
        source: generateAtomFeed(feedEntries, { ...feedOpts, feedUrl: atomFeedUrl }),
      });
    },
  };
}

interface CollectedEntry {
  slug: string;
  data: Record<string, unknown>;
  body?: string;
  html?: string;
}

type CollectedEntries = Record<string, CollectedEntry[]>;

interface ManifestResult {
  code: string;
  entries: CollectedEntries;
}

/**
 * Scan the content directory and generate a JS module exporting the content manifest.
 */
async function generateManifestModule(
  contentDir: string,
  opts: { embedHtml: boolean; embedBody: boolean; highlight?: boolean },
): Promise<ManifestResult> {
  if (!existsSync(contentDir)) {
    return {
      code: 'export const collections = {};',
      entries: {},
    };
  }

  const collections: CollectedEntries = {};

  const items = await readdir(contentDir, { withFileTypes: true });
  for (const item of items) {
    if (!item.isDirectory()) continue;

    const collectionName = item.name;
    collections[collectionName] = [];

    const collectionDir = join(contentDir, collectionName);
    const files = await readdir(collectionDir);

    for (const file of files) {
      const ext = extname(file);
      if (!CONTENT_EXTENSIONS.has(ext)) continue;

      const slug = basename(file, ext);
      const filePath = join(collectionDir, file);
      const raw = await readFile(filePath, 'utf-8');

      let data: Record<string, unknown> = {};
      let body: string | undefined;
      let html: string | undefined;

      if (ext === '.md') {
        const parsed = parseFrontmatter(raw);
        data = parsed.data;
        if (opts.embedBody) {
          body = parsed.body;
        }
        if (opts.embedHtml) {
          html = await renderMarkdown(parsed.body, {
            highlight: opts.highlight ?? true,
          });
          // Always store body internally for feed generation even if not embedded
          body = parsed.body;
        }
      } else if (ext === '.json') {
        try {
          data = JSON.parse(raw);
        } catch {
          /* skip invalid JSON */
        }
      } else if (ext === '.yaml' || ext === '.yml') {
        const parsed = parseFrontmatter(`---\n${raw}\n---\n`);
        data = parsed.data;
      }

      const entry: CollectedEntry = { slug, data };
      if (opts.embedBody && body !== undefined) {
        entry.body = body;
      }
      if (opts.embedHtml && html !== undefined) {
        entry.html = html;
      }

      collections[collectionName].push(entry);
    }
  }

  return {
    code: `export const collections = ${JSON.stringify(collections)};`,
    entries: collections,
  };
}

export { contentPlugin };
