# @matthesketh/utopia-content

Content collections, markdown pipeline, and MCP content server for UtopiaJS.

## Install

```bash
pnpm add @matthesketh/utopia-content
```

## Quick Start

Define a content collection with a typed schema, then query entries from the filesystem.

```ts
import { createContent, defineCollection, getCollection, getEntry } from '@matthesketh/utopia-content';

// Initialize the content system
createContent({ contentDir: 'content' });

// Define a blog collection
const blog = defineCollection({
  name: 'blog',
  directory: 'blog',
  schema: {
    title: { type: 'string', required: true },
    date: { type: 'date', required: true },
    tags: { type: 'array', items: 'string' },
    draft: { type: 'boolean', default: false },
  },
  formats: ['md', 'utopia', 'json', 'yaml'],
});

// Query all published posts
const posts = await getCollection('blog', {
  filter: (e) => !e.data.draft,
  sort: 'date',
  order: 'desc',
});

// Get a single post by slug
const post = await getEntry('blog', 'hello-world');
```

## Content Formats

**Markdown** — YAML frontmatter + markdown body, rendered to HTML automatically:

```markdown
---
title: Hello World
date: 2026-03-01
tags: [tutorial]
---

# Hello World

Content goes here.
```

**JSON** — structured data:

```json
{ "title": "Data Entry", "count": 42 }
```

**YAML** — structured data in YAML format.

**.utopia** — interactive content with components. Export `metadata` from the script block:

```html
<template>
  <article>
    <h1>{{ metadata.title }}</h1>
    <button @click="increment">Count: {{ count() }}</button>
  </article>
</template>

<script>
import { signal } from '@matthesketh/utopia-core';

export const metadata = { title: 'Interactive Post', date: '2026-03-01' };

const count = signal(0);
const increment = () => count.set(count() + 1);
</script>
```

## Schema Validation

Schemas validate frontmatter at query time. Missing required fields or type mismatches throw clear errors with the file path and field name.

| Type | Validates | Options |
|------|-----------|---------|
| `string` | `typeof value === 'string'` | `required`, `default` |
| `number` | `typeof value === 'number'` | `required`, `default` |
| `boolean` | `typeof value === 'boolean'` | `required`, `default` |
| `date` | Date object or valid date string | `required` |
| `array` | `Array.isArray(value)` | `items: 'string' \| 'number' \| 'boolean'` |

## MCP Content Server

Expose content operations as MCP tools so AI agents can manage your blog.

```ts
import { createContentMCPServer } from '@matthesketh/utopia-content/mcp';

const server = createContentMCPServer({
  contentDir: 'content',
  collections: [blog],
});

// JSON-RPC 2.0 — same pattern as @matthesketh/utopia-ai/mcp
const response = await server.handleRequest(request);
```

**Tools:** `list_collections`, `list_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `search_entries`, `list_tags`, `publish_entry`

**Resources:** `content://{collection}`, `content://{collection}/{slug}`

## Vite Plugin

Hot-reload content files during development and generate a virtual module with the content manifest.

```ts
import utopia from '@matthesketh/utopia-vite-plugin';
import content from '@matthesketh/utopia-content/vite';

export default {
  plugins: [utopia(), content({ contentDir: 'content' })],
};
```

Import the manifest in route components:

```ts
import { collections } from 'virtual:utopia-content';
```

## Blog Template

Scaffold a complete blog project:

```bash
npx create-utopia my-blog  # select "Content / Blog" in features
```

This creates a project with content directory, collection config, blog listing and single post routes, and the Vite content plugin pre-configured.

## API Reference

### `createContent(options)`

Initialize the content system. Call once before `defineCollection`.

- `contentDir` — base directory for content files

### `defineCollection(config)`

Register a content collection.

- `name` — collection name (used in queries)
- `directory` — subdirectory within `contentDir`
- `schema` — optional schema for frontmatter validation
- `formats` — allowed file formats (default: all)

### `getCollection(name, options?)`

Query all entries in a collection. Returns `ContentEntry[]`.

Options: `filter`, `sort`, `order` (`'asc'` | `'desc'`), `limit`, `offset`

### `getEntry(name, slug)`

Get a single entry by slug. Returns `ContentEntry | null`.

### `ContentEntry`

```ts
interface ContentEntry {
  slug: string;
  collection: string;
  data: Record<string, unknown>;  // validated frontmatter
  body: string;                    // raw content
  html?: string;                   // rendered HTML (markdown only)
  format: 'md' | 'utopia' | 'json' | 'yaml';
  filePath: string;
}
```

### `renderMarkdown(source, options?)`

Render markdown to HTML. Options: `remarkPlugins`, `rehypePlugins`, `highlight` (default: true).

### `parseFrontmatter(content)`

Extract YAML frontmatter and body from a string.

### `createFilesystemAdapter(baseDir?)`

Create a filesystem-based content adapter (default).

## License

[MIT](../../LICENSE)
