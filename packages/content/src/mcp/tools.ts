import type { CollectionConfig, ContentAdapter, ContentFormat } from '../types.js';

/** JSON Schema type (compatible with MCP tool definitions) */
interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string; enum?: string[] }>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
}

/** MCP tool definition */
export interface ContentToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** MCP tool result */
export interface ContentToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** MCP tool handler */
export interface ContentToolHandler {
  definition: ContentToolDefinition;
  handler: (params: Record<string, unknown>) => Promise<ContentToolResult>;
}

function textResult(data: unknown): ContentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ContentToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createContentTools(
  getCollections: () => Map<string, { config: CollectionConfig; adapter: ContentAdapter }>,
): ContentToolHandler[] {
  function getCollection(name: string) {
    const col = getCollections().get(name);
    if (!col) throw new Error(`Collection "${name}" not found`);
    return col;
  }

  return [
    {
      definition: {
        name: 'list_collections',
        description: 'List all defined content collections',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => {
        const names = Array.from(getCollections().keys());
        return textResult({ collections: names });
      },
    },
    {
      definition: {
        name: 'list_entries',
        description: 'List entries in a content collection, with optional tag filter',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            tag: { type: 'string', description: 'Filter by tag (optional)' },
            draft: { type: 'string', description: 'Filter by draft status: "true", "false", or "all" (default: "all")', enum: ['true', 'false', 'all'] },
          },
          required: ['collection'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        let entries = await adapter.readEntries(config);

        const tag = params.tag as string | undefined;
        if (tag) {
          entries = entries.filter(e => {
            const tags = e.data.tags;
            return Array.isArray(tags) && tags.includes(tag);
          });
        }

        const draftFilter = params.draft as string | undefined;
        if (draftFilter === 'true') {
          entries = entries.filter(e => e.data.draft === true);
        } else if (draftFilter === 'false') {
          entries = entries.filter(e => e.data.draft !== true);
        }

        return textResult({
          collection: params.collection,
          count: entries.length,
          entries: entries.map(e => ({ slug: e.slug, ...e.data })),
        });
      },
    },
    {
      definition: {
        name: 'get_entry',
        description: 'Read a single content entry by collection and slug',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            slug: { type: 'string', description: 'Entry slug (filename without extension)' },
          },
          required: ['collection', 'slug'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        const entry = await adapter.readEntry(config, params.slug as string);
        if (!entry) return errorResult(`Entry "${params.slug}" not found in "${params.collection}"`);
        return textResult({ slug: entry.slug, data: entry.data, body: entry.body, html: entry.html, format: entry.format });
      },
    },
    {
      definition: {
        name: 'create_entry',
        description: 'Create a new content entry in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            slug: { type: 'string', description: 'Entry slug (becomes the filename)' },
            data: { type: 'object', description: 'Frontmatter / metadata fields' },
            body: { type: 'string', description: 'Content body (markdown, etc.)' },
            format: { type: 'string', description: 'File format (default: md)', enum: ['md', 'json', 'yaml'] },
          },
          required: ['collection', 'slug', 'body'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        const data = (params.data as Record<string, unknown>) ?? {};
        const format = (params.format as ContentFormat) ?? 'md';
        await adapter.writeEntry(config, params.slug as string, data, params.body as string, format);
        return textResult({ created: true, slug: params.slug, collection: params.collection });
      },
    },
    {
      definition: {
        name: 'update_entry',
        description: 'Update an existing content entry (merge data, replace body)',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            slug: { type: 'string', description: 'Entry slug' },
            data: { type: 'object', description: 'Frontmatter fields to merge (optional)' },
            body: { type: 'string', description: 'New body content (optional, replaces existing)' },
          },
          required: ['collection', 'slug'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        await adapter.updateEntry(
          config,
          params.slug as string,
          params.data as Record<string, unknown> | undefined,
          params.body as string | undefined,
        );
        return textResult({ updated: true, slug: params.slug, collection: params.collection });
      },
    },
    {
      definition: {
        name: 'delete_entry',
        description: 'Delete a content entry from a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            slug: { type: 'string', description: 'Entry slug to delete' },
          },
          required: ['collection', 'slug'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        await adapter.deleteEntry(config, params.slug as string);
        return textResult({ deleted: true, slug: params.slug, collection: params.collection });
      },
    },
    {
      definition: {
        name: 'search_entries',
        description: 'Full-text search across entries in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            query: { type: 'string', description: 'Search query' },
          },
          required: ['collection', 'query'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        const entries = await adapter.readEntries(config);
        const query = (params.query as string).toLowerCase();
        const matches = entries.filter(e => {
          const title = String(e.data.title ?? '').toLowerCase();
          const body = e.body.toLowerCase();
          return title.includes(query) || body.includes(query);
        });
        return textResult({
          query: params.query,
          count: matches.length,
          entries: matches.map(e => ({ slug: e.slug, ...e.data })),
        });
      },
    },
    {
      definition: {
        name: 'list_tags',
        description: 'List all unique tags across entries in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
          },
          required: ['collection'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        const entries = await adapter.readEntries(config);
        const tags = new Set<string>();
        for (const entry of entries) {
          const entryTags = entry.data.tags;
          if (Array.isArray(entryTags)) {
            for (const tag of entryTags) tags.add(String(tag));
          }
        }
        return textResult({ collection: params.collection, tags: Array.from(tags).sort() });
      },
    },
    {
      definition: {
        name: 'publish_entry',
        description: 'Publish a draft entry (sets draft: false)',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            slug: { type: 'string', description: 'Entry slug to publish' },
          },
          required: ['collection', 'slug'],
        },
      },
      handler: async (params) => {
        const { config, adapter } = getCollection(params.collection as string);
        await adapter.updateEntry(config, params.slug as string, { draft: false });
        return textResult({ published: true, slug: params.slug, collection: params.collection });
      },
    },
  ];
}
