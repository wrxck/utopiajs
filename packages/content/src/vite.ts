import type { Plugin } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseFrontmatter } from './frontmatter.js';

export interface ContentPluginOptions {
  /** Base directory for content files (default: 'content') */
  contentDir?: string;
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
 *     content({ contentDir: 'content' }),
 *   ],
 * };
 * ```
 */
export default function contentPlugin(options: ContentPluginOptions = {}): Plugin {
  const contentDir = options.contentDir ?? 'content';
  let resolvedContentDir: string;

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
        return await generateManifestModule(resolvedContentDir);
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
      // Let the watcher handler above deal with it
      return [];
    },
  };
}

/**
 * Scan the content directory and generate a JS module exporting the content manifest.
 */
async function generateManifestModule(contentDir: string): Promise<string> {
  if (!existsSync(contentDir)) {
    return 'export const collections = {}; export const entries = {};';
  }

  const collections: Record<string, Array<{ slug: string; data: Record<string, unknown> }>> = {};

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

      if (ext === '.md') {
        const parsed = parseFrontmatter(raw);
        data = parsed.data;
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

      collections[collectionName].push({ slug, data });
    }
  }

  return `export const collections = ${JSON.stringify(collections)};`;
}

export { contentPlugin };
