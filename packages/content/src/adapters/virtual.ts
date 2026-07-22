import type { ContentAdapter, CollectionConfig, ContentEntry, ContentFormat } from '../types';

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
  function toContentEntry(collection: string, entry: VirtualEntry): ContentEntry {
    return {
      slug: entry.slug,
      collection,
      data: entry.data,
      body: entry.body ?? '',
      html: entry.html,
      format: 'md' as ContentFormat,
      filePath: `virtual:${collection}/${entry.slug}`,
    };
  }

  return {
    async readEntries(config: CollectionConfig): Promise<ContentEntry[]> {
      const entries = collections[config.name];
      if (!entries) return [];
      return entries.map((entry) => toContentEntry(config.name, entry));
    },

    async readEntry(config: CollectionConfig, slug: string): Promise<ContentEntry | null> {
      const entry = collections[config.name]?.find((e) => e.slug === slug);
      if (!entry) return null;
      return toContentEntry(config.name, entry);
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
