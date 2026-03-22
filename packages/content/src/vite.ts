import type { Plugin } from 'vite';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseFrontmatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { generateRssFeed, generateAtomFeed } from './feed.js';
import type { FeedOptions } from './feed.js';
import type { SeoOptions, SeoConfig, SeoEntry } from './seo/types.js';
import { extractAssetTags, generatePrerenderedPage } from './seo/prerender.js';
import { generateAmpPage } from './seo/amp.js';
import { generateOgSvg, svgToPng } from './seo/og-image.js';
import { generateSitemap } from './seo/sitemap.js';
import { generateRobots } from './seo/robots.js';

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
  /** Generate SEO assets (pre-rendered pages, AMP, OG images, sitemap, robots.txt) */
  seo?: SeoOptions;
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
  let resolvedOutDir: string;
  let resolvedRoot: string;
  let collectedEntries: CollectedEntries = {};

  return {
    name: 'utopia-content',

    configResolved(config) {
      resolvedContentDir = resolve(config.root, contentDir);
      resolvedOutDir = resolve(config.root, config.build.outDir);
      resolvedRoot = config.root;
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

    async writeBundle() {
      if (!options.seo) return;

      const feedOpts = options.feed;
      const seoOpts = options.seo;
      const collectionName = seoOpts.collection ?? feedOpts?.collection ?? 'blog';
      const filterDrafts = seoOpts.filterDrafts ?? feedOpts?.filterDrafts ?? true;
      const routePrefix = seoOpts.routePrefix ?? 'blog';

      // Resolve SEO config, defaulting from feed options
      const seoConfig: SeoConfig = {
        siteUrl: seoOpts.siteUrl ?? feedOpts?.siteUrl ?? '',
        siteTitle: seoOpts.siteTitle ?? feedOpts?.title ?? '',
        siteDescription: seoOpts.siteDescription ?? feedOpts?.description ?? '',
        author: seoOpts.author,
        locale: seoOpts.locale ?? 'en_GB',
        collection: collectionName,
        filterDrafts,
        routePrefix,
        amp: seoOpts.amp ?? true,
        sitemap: seoOpts.sitemap ?? true,
        robots: seoOpts.robots ?? true,
        ogImage: seoOpts.ogImage ?? true,
      };

      if (!seoConfig.siteUrl) {
        console.warn('[utopia-content] seo: siteUrl is required. Skipping SEO generation.');
        return;
      }

      const entries = collectedEntries[collectionName];
      if (!entries || entries.length === 0) return;

      // Filter and sort entries
      const seoEntries: SeoEntry[] = entries
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
          tags: e.data.tags as string[] | undefined,
          html: e.html,
          image: e.data.image as string | undefined,
        }));

      // Read built index.html for asset extraction
      const indexPath = join(resolvedOutDir, 'index.html');
      let assets = { scripts: '', styles: '' };
      if (existsSync(indexPath)) {
        const indexHtml = await readFile(indexPath, 'utf-8');
        assets = extractAssetTags(indexHtml);
      }

      // OG image config
      const ogImageConfig = typeof seoConfig.ogImage === 'object' ? seoConfig.ogImage : undefined;

      // Try to resolve sharp from the consuming project
      let sharpFn: ((input: Buffer) => any) | undefined;
      if (seoConfig.ogImage) {
        try {
          const require = createRequire(join(resolvedRoot, 'package.json'));
          sharpFn = require('sharp');
        } catch {
          console.warn('[utopia-content] sharp not found — OG images will be SVG instead of PNG.');
        }
      }

      for (const entry of seoEntries) {
        // Pre-rendered HTML page
        const prerenderedDir = join(resolvedOutDir, routePrefix, entry.slug);
        await mkdir(prerenderedDir, { recursive: true });
        const prerenderedHtml = generatePrerenderedPage(entry, seoConfig, assets);
        await writeFile(join(prerenderedDir, 'index.html'), prerenderedHtml, 'utf-8');

        // AMP page
        if (seoConfig.amp) {
          const ampDir = join(resolvedOutDir, 'amp', routePrefix, entry.slug);
          await mkdir(ampDir, { recursive: true });
          const ampHtml = generateAmpPage(entry, seoConfig);
          await writeFile(join(ampDir, 'index.html'), ampHtml, 'utf-8');
        }

        // OG image
        if (seoConfig.ogImage && !entry.image) {
          const ogDir = join(resolvedOutDir, 'og');
          await mkdir(ogDir, { recursive: true });
          const svg = generateOgSvg(entry, ogImageConfig);
          const png = await svgToPng(svg, sharpFn);
          if (png) {
            await writeFile(join(ogDir, `${entry.slug}.png`), png);
          } else {
            await writeFile(join(ogDir, `${entry.slug}.svg`), svg, 'utf-8');
          }
        }
      }

      // Sitemap
      if (seoConfig.sitemap) {
        const sitemap = generateSitemap(seoEntries, seoConfig);
        await writeFile(join(resolvedOutDir, 'sitemap.xml'), sitemap, 'utf-8');
      }

      // Robots.txt
      if (seoConfig.robots) {
        const robots = generateRobots(seoConfig);
        await writeFile(join(resolvedOutDir, 'robots.txt'), robots, 'utf-8');
      }

      console.log(
        `[utopia-content] SEO: generated ${seoEntries.length} pre-rendered pages` +
          (seoConfig.amp ? `, ${seoEntries.length} AMP pages` : '') +
          (seoConfig.ogImage ? `, OG images` : '') +
          (seoConfig.sitemap ? `, sitemap.xml` : '') +
          (seoConfig.robots ? `, robots.txt` : ''),
      );
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
