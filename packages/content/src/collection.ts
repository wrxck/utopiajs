import type {
  CollectionConfig,
  CollectionSchema,
  Collection,
  ContentEntry,
  ContentAdapter,
  QueryOptions,
} from './types.js';
import { validateSchema, applyDefaults } from './schema.js';
import { createFilesystemAdapter } from './adapters/filesystem.js';

/** Registry of defined collections */
const collections = new Map<string, Collection>();

/** Global base directory for content (set via createContent) */
let globalBaseDir: string | undefined;
let globalAdapter: ContentAdapter | undefined;

/**
 * Initialize the content system with a base directory.
 */
export function createContent(options: { contentDir: string; adapter?: ContentAdapter }): void {
  globalBaseDir = options.contentDir;
  globalAdapter = options.adapter ?? createFilesystemAdapter(options.contentDir);
}

/**
 * Define a content collection with an optional typed schema.
 */
export function defineCollection<S extends CollectionSchema = CollectionSchema>(
  config: CollectionConfig<S>,
): CollectionConfig<S> {
  const adapter = globalAdapter ?? createFilesystemAdapter(globalBaseDir);
  collections.set(config.name, { config, adapter });
  return config;
}

/**
 * Get all entries from a collection, with optional filtering and sorting.
 */
export async function getCollection(name: string, options?: QueryOptions): Promise<ContentEntry[]> {
  const collection = collections.get(name);
  if (!collection) {
    throw new Error(`Collection "${name}" is not defined. Call defineCollection() first.`);
  }

  let entries = await collection.adapter.readEntries(collection.config);

  // Validate and apply defaults
  if (collection.config.schema) {
    entries = entries.map((entry) => {
      entry.data = applyDefaults(entry.data, collection.config.schema!);
      const errors = validateSchema(entry.data, collection.config.schema!);
      if (errors.length > 0) {
        const messages = errors.map((e) => e.message).join(', ');
        throw new Error(`Validation error in "${entry.filePath}": ${messages}`);
      }
      return entry;
    });
  }

  // Apply query options
  if (options?.filter) {
    entries = entries.filter(options.filter);
  }

  if (options?.sort) {
    const sortField = options.sort;
    const order = options.order ?? 'asc';
    entries.sort((a, b) => {
      const aVal = getNestedValue(a.data, sortField) as string | number | boolean | Date;
      const bVal = getNestedValue(b.data, sortField) as string | number | boolean | Date;
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }

  if (options?.offset) {
    entries = entries.slice(options.offset);
  }

  if (options?.limit) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

/**
 * Get a single entry from a collection by slug.
 */
export async function getEntry(name: string, slug: string): Promise<ContentEntry | null> {
  const collection = collections.get(name);
  if (!collection) {
    throw new Error(`Collection "${name}" is not defined. Call defineCollection() first.`);
  }

  const entry = await collection.adapter.readEntry(collection.config, slug);
  if (!entry) return null;

  if (collection.config.schema) {
    entry.data = applyDefaults(entry.data, collection.config.schema);
    const errors = validateSchema(entry.data, collection.config.schema);
    if (errors.length > 0) {
      const messages = errors.map((e) => e.message).join(', ');
      throw new Error(`Validation error in "${entry.filePath}": ${messages}`);
    }
  }

  return entry;
}

/**
 * Get the adapter for a collection (used by MCP server).
 */
export function getCollectionAdapter(
  name: string,
): { config: CollectionConfig; adapter: ContentAdapter } | null {
  return collections.get(name) ?? null;
}

/**
 * List all registered collection names.
 */
export function listCollections(): string[] {
  return Array.from(collections.keys());
}

/**
 * Clear all registered collections (useful for testing).
 */
export function clearCollections(): void {
  collections.clear();
  globalBaseDir = undefined;
  globalAdapter = undefined;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((curr, key) => {
    if (curr && typeof curr === 'object') {
      return (curr as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
