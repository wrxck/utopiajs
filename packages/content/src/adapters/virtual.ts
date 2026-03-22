import type { ContentAdapter, CollectionConfig, ContentEntry, ContentFormat } from '../types.js';

export interface VirtualEntry {
  slug: string;
  data: Record<string, unknown>;
  body?: string;
  html?: string;
}

export type VirtualCollections = Record<string, VirtualEntry[]>;

/**
 * Create a read-only content adapter that reads from in-memory data
 * (typically sourced from the virtual:utopia-content Vite module).
 */
export function createVirtualAdapter(collections: VirtualCollections): ContentAdapter {
  return {
    async readEntries(config: CollectionConfig): Promise<ContentEntry[]> {
      const entries = collections[config.name];
      if (!entries) return [];

      return entries.map((entry) => ({
        slug: entry.slug,
        collection: config.name,
        data: entry.data,
        body: entry.body ?? '',
        html: entry.html,
        format: 'md' as ContentFormat,
        filePath: `virtual:${config.name}/${entry.slug}`,
      }));
    },

    async readEntry(config: CollectionConfig, slug: string): Promise<ContentEntry | null> {
      const entries = collections[config.name];
      if (!entries) return null;

      const entry = entries.find((e) => e.slug === slug);
      if (!entry) return null;

      return {
        slug: entry.slug,
        collection: config.name,
        data: entry.data,
        body: entry.body ?? '',
        html: entry.html,
        format: 'md' as ContentFormat,
        filePath: `virtual:${config.name}/${entry.slug}`,
      };
    },

    async writeEntry(): Promise<void> {
      throw new Error('Virtual adapter is read-only');
    },

    async updateEntry(): Promise<void> {
      throw new Error('Virtual adapter is read-only');
    },

    async deleteEntry(): Promise<void> {
      throw new Error('Virtual adapter is read-only');
    },

    async listSlugs(config: CollectionConfig): Promise<string[]> {
      const entries = collections[config.name];
      if (!entries) return [];
      return entries.map((e) => e.slug);
    },
  };
}
