# Content & Blog

`@matthesketh/utopia-content` provides file-based content collections for UtopiaJS applications. Define typed schemas for your content, query entries from the filesystem, render markdown to HTML, and manage everything through an MCP server that AI agents can call directly.

The design follows the Astro content collections model: drop files in a directory, define a schema, and query with type-safe results. The MCP server on top is what makes it unique -- no other framework lets AI agents create, edit, search, and publish blog posts out of the box.

## Quick Start

```bash
pnpm add @matthesketh/utopia-content
```

```ts
import { createContent, defineCollection, getCollection } from '@matthesketh/utopia-content';

createContent({ contentDir: 'content' });

const blog = defineCollection({
  name: 'blog',
  directory: 'blog',
  schema: {
    title: { type: 'string', required: true },
    date: { type: 'date', required: true },
    tags: { type: 'array', items: 'string' },
    draft: { type: 'boolean', default: false },
  },
});

const posts = await getCollection('blog', {
  filter: (e) => !e.data.draft,
  sort: 'date',
  order: 'desc',
});
```

## Content Formats

### Markdown

The default. YAML frontmatter for metadata, markdown body rendered to HTML via a unified/remark/rehype pipeline with syntax highlighting.

```markdown
---
title: Hello World
date: 2026-03-01
tags: [tutorial, beginner]
draft: false
---

# Hello World

Regular markdown. Code blocks get syntax highlighting automatically.
```

### .utopia files

Interactive content using the standard SFC format. Export `metadata` from the script block instead of using frontmatter.

```html
<template>
  <article>
    <h1>{{ metadata.title }}</h1>
    <button @click="increment">Count: {{ count() }}</button>
  </article>
</template>

<script>
import { signal } from '@matthesketh/utopia-core';

export const metadata = {
  title: 'Interactive Demo',
  date: '2026-03-01',
  tags: ['demo'],
};

const count = signal(0);
const increment = () => count.set(count() + 1);
</script>
```

### JSON and YAML

Structured data collections. Useful for team members, product catalogs, configuration -- anything that isn't a blog post.

```json
[
  { "name": "Alice", "role": "Engineer" },
  { "name": "Bob", "role": "Designer" }
]
```

## Schema Validation

Schemas are optional but recommended. They validate frontmatter at query time -- if a field is missing or the wrong type, you get a clear error with the file path and field name instead of a silent runtime bug.

```ts
const blog = defineCollection({
  name: 'blog',
  directory: 'blog',
  schema: {
    title: { type: 'string', required: true },
    date: { type: 'date', required: true },
    tags: { type: 'array', items: 'string' },
    draft: { type: 'boolean', default: false },
    excerpt: { type: 'string' },
  },
});
```

Supported field types:

| Type | What it checks | Options |
|------|----------------|---------|
| `string` | `typeof value === 'string'` | `required`, `default` |
| `number` | `typeof value === 'number'`, rejects NaN | `required`, `default` |
| `boolean` | `typeof value === 'boolean'` | `required`, `default` |
| `date` | Date object or parseable date string | `required` |
| `array` | `Array.isArray(value)`, optional item type checking | `items: 'string' \| 'number' \| 'boolean'` |

Defaults are applied before validation. A field with `default: false` will be `false` if missing from the frontmatter, not undefined.

## Querying Content

### All entries

```ts
const posts = await getCollection('blog');
```

### Filtered and sorted

```ts
const published = await getCollection('blog', {
  filter: (e) => !e.data.draft,
  sort: 'date',
  order: 'desc',
  limit: 10,
  offset: 0,
});
```

### Single entry

```ts
const post = await getEntry('blog', 'hello-world');
// Returns null if not found
```

### Entry shape

Every entry has the same structure:

```ts
{
  slug: 'hello-world',           // filename without extension
  collection: 'blog',            // collection name
  data: { title: '...', ... },   // validated frontmatter
  body: '# Hello\n...',          // raw content
  html: '<h1>Hello</h1>...',     // rendered HTML (markdown only)
  format: 'md',                  // source format
  filePath: '/abs/path/hello-world.md',
}
```

## MCP Content Server

The MCP server exposes content operations as JSON-RPC 2.0 tools. Any MCP client -- Claude Code, VS Code extensions, custom agents -- can manage your blog through tool calls.

```ts
import { createContentMCPServer } from '@matthesketh/utopia-content/mcp';

const server = createContentMCPServer({
  contentDir: 'content',
  collections: [blog, pages],
});

const response = await server.handleRequest({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: {
    name: 'create_entry',
    arguments: {
      collection: 'blog',
      slug: 'new-post',
      data: { title: 'New Post', date: '2026-03-01' },
      body: '# New Post\n\nContent here.',
    },
  },
});
```

### Available tools

| Tool | Description |
|------|-------------|
| `list_collections` | List all defined content collections |
| `list_entries` | List entries with optional tag/draft filters |
| `get_entry` | Read a single entry by collection + slug |
| `create_entry` | Create a new content file |
| `update_entry` | Update frontmatter and/or body |
| `delete_entry` | Delete a content file |
| `search_entries` | Full-text search across a collection |
| `list_tags` | List all unique tags in a collection |
| `publish_entry` | Set `draft: false` on an entry |

### Resources

The server also exposes content as MCP resources:

- `content://blog` -- list of all entries in the blog collection
- `content://blog/hello-world` -- full entry content

## Vite Plugin

The content Vite plugin watches your content directory for changes and triggers hot reload. It also generates a `virtual:utopia-content` module with the content manifest.

```ts
// vite.config.ts
import utopia from '@matthesketh/utopia-vite-plugin';
import content from '@matthesketh/utopia-content/vite';

export default {
  plugins: [
    utopia(),
    content({ contentDir: 'content' }),
  ],
};
```

In your route components:

```ts
import { collections } from 'virtual:utopia-content';
// { blog: [{ slug: 'hello-world', data: { title: '...', ... } }] }
```

## Blog Template

The fastest way to get started. Select "Content / Blog" when creating a new project:

```bash
npx create-utopia my-blog
```

This scaffolds:

```
my-blog/
├── content/
│   └── blog/
│       └── hello-world.md          # example post
├── src/
│   ├── routes/
│   │   ├── +layout.utopia
│   │   ├── +page.utopia
│   │   └── blog/
│   │       └── [slug]/+page.utopia
│   ├── content.config.ts           # collection definition
│   ├── entry-client.ts
│   └── entry-server.ts
├── vite.config.ts
└── package.json
```

## Markdown Pipeline

Under the hood, markdown rendering uses unified with this pipeline:

1. `remark-parse` -- parse markdown to mdast
2. Custom remark plugins (if configured)
3. `remark-rehype` -- convert to hast
4. `rehype-highlight` -- syntax highlighting for code blocks
5. Custom rehype plugins (if configured)
6. `rehype-stringify` -- serialize to HTML

You can extend the pipeline by passing plugins to `renderMarkdown()`:

```ts
import { renderMarkdown } from '@matthesketh/utopia-content';

const html = await renderMarkdown(source, {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeSlug],
  highlight: true,  // default
});
```
