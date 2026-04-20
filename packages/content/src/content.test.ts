// ============================================================================
// @matthesketh/utopia-content — Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import { validateSchema, applyDefaults } from './schema.js';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { renderMarkdown } from './markdown.js';
import { createFilesystemAdapter } from './adapters/filesystem.js';
import { createVirtualAdapter } from './adapters/virtual.js';
import { generateRssFeed, generateAtomFeed } from './feed.js';
import {
  createContent,
  defineCollection,
  getCollection,
  getEntry,
  listCollections,
  clearCollections,
} from './collection.js';
import { createContentMCPServer } from './mcp/index.js';
import type { CollectionSchema } from './types.js';
import type { FeedEntry, FeedOptions } from './feed.js';

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('validateSchema', () => {
  const schema: CollectionSchema = {
    title: { type: 'string', required: true },
    count: { type: 'number' },
    draft: { type: 'boolean', default: false },
    date: { type: 'date', required: true },
    tags: { type: 'array', items: 'string' },
  };

  it('passes valid data', () => {
    const errors = validateSchema({ title: 'Hello', date: '2026-01-01', tags: ['a', 'b'] }, schema);
    expect(errors).toEqual([]);
  });

  it('reports missing required fields', () => {
    const errors = validateSchema({ count: 5 }, schema);
    expect(errors).toHaveLength(2);
    expect(errors[0].field).toBe('title');
    expect(errors[1].field).toBe('date');
  });

  it('reports type mismatches', () => {
    const errors = validateSchema({ title: 123, date: '2026-01-01' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('title');
    expect(errors[0].message).toContain('string');
  });

  it('validates number fields', () => {
    const errors = validateSchema(
      { title: 'Hi', date: '2026-01-01', count: 'not-a-number' },
      schema,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('count');
  });

  it('validates boolean fields', () => {
    const errors = validateSchema({ title: 'Hi', date: '2026-01-01', draft: 'yes' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('draft');
  });

  it('validates date strings', () => {
    const errors = validateSchema({ title: 'Hi', date: 'not-a-date' }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('date');
  });

  it('accepts Date objects', () => {
    const errors = validateSchema({ title: 'Hi', date: new Date('2026-01-01') }, schema);
    expect(errors).toEqual([]);
  });

  it('rejects invalid Date objects', () => {
    const errors = validateSchema({ title: 'Hi', date: new Date('invalid') }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('date');
  });

  it('validates array fields', () => {
    const errors = validateSchema(
      { title: 'Hi', date: '2026-01-01', tags: 'not-an-array' },
      schema,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('tags');
  });

  it('validates array item types', () => {
    const errors = validateSchema({ title: 'Hi', date: '2026-01-01', tags: ['a', 123] }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('tags[1]');
  });

  it('skips optional fields when null', () => {
    const errors = validateSchema({ title: 'Hi', date: '2026-01-01', count: null }, schema);
    expect(errors).toEqual([]);
  });

  it('rejects NaN as a number', () => {
    const errors = validateSchema({ title: 'Hi', date: '2026-01-01', count: NaN }, schema);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('count');
  });
});

describe('applyDefaults', () => {
  const schema: CollectionSchema = {
    title: { type: 'string', required: true },
    draft: { type: 'boolean', default: false },
    count: { type: 'number', default: 0 },
  };

  it('applies defaults for missing fields', () => {
    const result = applyDefaults({ title: 'Hi' }, schema);
    expect(result).toEqual({ title: 'Hi', draft: false, count: 0 });
  });

  it('does not override existing values', () => {
    const result = applyDefaults({ title: 'Hi', draft: true, count: 5 }, schema);
    expect(result).toEqual({ title: 'Hi', draft: true, count: 5 });
  });

  it('applies defaults for null values', () => {
    const result = applyDefaults({ title: 'Hi', draft: null }, schema);
    expect(result).toEqual({ title: 'Hi', draft: false, count: 0 });
  });

  it('returns a new object (does not mutate input)', () => {
    const input = { title: 'Hi' };
    const result = applyDefaults(input, schema);
    expect(result).not.toBe(input);
    expect(input).not.toHaveProperty('draft');
  });
});

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('extracts YAML frontmatter and body', () => {
    const result = parseFrontmatter(`---
title: Hello World
date: 2026-01-01
---

# Content here`);
    expect(result.data.title).toBe('Hello World');
    expect(result.body.trim()).toBe('# Content here');
  });

  it('handles no frontmatter', () => {
    const result = parseFrontmatter('Just body text');
    expect(result.data).toEqual({});
    expect(result.body).toBe('Just body text');
  });

  it('handles empty frontmatter', () => {
    const result = parseFrontmatter(`---
---
Body`);
    expect(result.data).toEqual({});
    expect(result.body.trim()).toBe('Body');
  });

  it('parses arrays in frontmatter', () => {
    const result = parseFrontmatter(`---
tags:
  - one
  - two
---
Body`);
    expect(result.data.tags).toEqual(['one', 'two']);
  });

  it('parses nested objects', () => {
    const result = parseFrontmatter(`---
author:
  name: Alice
  email: alice@example.com
---
Body`);
    expect(result.data.author).toEqual({ name: 'Alice', email: 'alice@example.com' });
  });
});

describe('serializeFrontmatter', () => {
  it('serializes data and body to markdown with frontmatter', () => {
    const result = serializeFrontmatter({ title: 'Test' }, 'Hello world');
    expect(result).toContain('title: Test');
    expect(result).toContain('Hello world');
  });

  it('round-trips through parse and serialize', () => {
    const original = `---
title: Round Trip
draft: false
---

Content body`;
    const { data, body } = parseFrontmatter(original);
    const serialized = serializeFrontmatter(data, body);
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed.data.title).toBe('Round Trip');
    expect(reparsed.data.draft).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', async () => {
    const html = await renderMarkdown('# Hello\n\nA paragraph.');
    expect(html).toContain('<h1 id="hello">Hello</h1>');
    expect(html).toContain('<p>A paragraph.</p>');
  });

  it('renders inline formatting', async () => {
    const html = await renderMarkdown('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders links', async () => {
    const html = await renderMarkdown('[link](https://example.com)');
    expect(html).toContain('<a href="https://example.com">link</a>');
  });

  it('renders code blocks', async () => {
    const html = await renderMarkdown('```js\nconst x = 1;\n```');
    expect(html).toContain('<code');
    expect(html).toContain('language-js');
    expect(html).toContain('const');
  });

  it('renders lists', async () => {
    const html = await renderMarkdown('- one\n- two\n- three');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  it('can disable highlighting', async () => {
    const html = await renderMarkdown('```\ncode\n```', { highlight: false });
    expect(html).toContain('<code>');
  });
});

// ---------------------------------------------------------------------------
// Filesystem adapter
// ---------------------------------------------------------------------------

describe('createFilesystemAdapter', () => {
  let tmpDir: string;
  let blogDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-content-'));
    blogDir = join(tmpDir, 'blog');
    await mkdir(blogDir, { recursive: true });

    // Create test content files
    await writeFile(
      join(blogDir, 'hello.md'),
      `---
title: Hello World
date: 2026-01-01
tags:
  - intro
draft: false
---

# Hello World

Welcome to the blog.`,
    );

    await writeFile(
      join(blogDir, 'second-post.md'),
      `---
title: Second Post
date: 2026-02-01
tags:
  - update
draft: true
---

# Second Post

Another post.`,
    );

    await writeFile(
      join(blogDir, 'data.json'),
      JSON.stringify({
        title: 'JSON Entry',
        count: 42,
      }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const blogConfig = {
    name: 'blog',
    directory: 'blog',
    formats: ['md' as const, 'json' as const],
  };

  it('reads all entries from a directory', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entries = await adapter.readEntries(blogConfig);
    expect(entries).toHaveLength(3);
  });

  it('reads markdown entries with frontmatter and HTML', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entry = await adapter.readEntry(blogConfig, 'hello');
    expect(entry).not.toBeNull();
    expect(entry!.data.title).toBe('Hello World');
    expect(entry!.html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(entry!.format).toBe('md');
  });

  it('reads JSON entries', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entry = await adapter.readEntry(blogConfig, 'data');
    expect(entry).not.toBeNull();
    expect(entry!.data.title).toBe('JSON Entry');
    expect(entry!.data.count).toBe(42);
    expect(entry!.format).toBe('json');
  });

  it('returns null for missing entries', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entry = await adapter.readEntry(blogConfig, 'nonexistent');
    expect(entry).toBeNull();
  });

  it('lists slugs', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const slugs = await adapter.listSlugs(blogConfig);
    expect(slugs).toContain('hello');
    expect(slugs).toContain('second-post');
    expect(slugs).toContain('data');
  });

  it('writes a new markdown entry', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await adapter.writeEntry(
      blogConfig,
      'new-post',
      { title: 'New Post', date: '2026-03-01' },
      'New content',
    );
    const entry = await adapter.readEntry(blogConfig, 'new-post');
    expect(entry).not.toBeNull();
    expect(entry!.data.title).toBe('New Post');
  });

  it('writes a JSON entry', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await adapter.writeEntry(blogConfig, 'new-data', { key: 'value' }, '', 'json');
    const entry = await adapter.readEntry(blogConfig, 'new-data');
    expect(entry).not.toBeNull();
    expect(entry!.data.key).toBe('value');
  });

  it('updates an existing entry', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await adapter.updateEntry(blogConfig, 'hello', { title: 'Updated Title' });
    const entry = await adapter.readEntry(blogConfig, 'hello');
    expect(entry!.data.title).toBe('Updated Title');
  });

  it('throws when updating a nonexistent entry', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await expect(adapter.updateEntry(blogConfig, 'ghost', {})).rejects.toThrow('not found');
  });

  it('deletes an entry', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await adapter.deleteEntry(blogConfig, 'hello');
    const entry = await adapter.readEntry(blogConfig, 'hello');
    expect(entry).toBeNull();
  });

  it('throws when deleting a nonexistent entry', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await expect(adapter.deleteEntry(blogConfig, 'ghost')).rejects.toThrow('not found');
  });

  it('returns empty for nonexistent directory', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entries = await adapter.readEntries({ name: 'missing', directory: 'missing' });
    expect(entries).toEqual([]);
  });

  it('filters by format', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entries = await adapter.readEntries({
      name: 'blog',
      directory: 'blog',
      formats: ['json'],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].format).toBe('json');
  });

  it('creates directory if it does not exist on write', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await adapter.writeEntry(
      { name: 'newcol', directory: 'newcol' },
      'first',
      { title: 'First' },
      'Content',
    );
    expect(existsSync(join(tmpDir, 'newcol', 'first.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Collection engine
// ---------------------------------------------------------------------------

describe('collection engine', () => {
  let tmpDir: string;

  beforeEach(async () => {
    clearCollections();
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-col-'));
    const blogDir = join(tmpDir, 'blog');
    await mkdir(blogDir, { recursive: true });

    await writeFile(
      join(blogDir, 'alpha.md'),
      `---
title: Alpha
date: 2026-01-01
draft: false
---
Alpha content`,
    );

    await writeFile(
      join(blogDir, 'beta.md'),
      `---
title: Beta
date: 2026-02-01
draft: true
---
Beta content`,
    );

    await writeFile(
      join(blogDir, 'gamma.md'),
      `---
title: Gamma
date: 2026-03-01
draft: false
---
Gamma content`,
    );
  });

  afterEach(async () => {
    clearCollections();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('defines and queries a collection', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog');
    expect(entries).toHaveLength(3);
  });

  it('throws for undefined collection', async () => {
    await expect(getCollection('nope')).rejects.toThrow('not defined');
  });

  it('gets a single entry by slug', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entry = await getEntry('blog', 'alpha');
    expect(entry).not.toBeNull();
    expect(entry!.data.title).toBe('Alpha');
  });

  it('returns null for missing entry', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entry = await getEntry('blog', 'missing');
    expect(entry).toBeNull();
  });

  it('filters entries', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', {
      filter: (e) => e.data.draft !== true,
    });
    expect(entries).toHaveLength(2);
  });

  it('sorts entries', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', { sort: 'title', order: 'desc' });
    expect(entries[0].data.title).toBe('Gamma');
    expect(entries[2].data.title).toBe('Alpha');
  });

  it('limits entries', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', { sort: 'title', limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it('offsets entries', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', { sort: 'title', offset: 1 });
    expect(entries).toHaveLength(2);
  });

  it('validates against schema', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({
      name: 'blog',
      directory: 'blog',
      schema: {
        title: { type: 'string', required: true },
        date: { type: 'date', required: true },
        draft: { type: 'boolean', default: false },
      },
    });
    const entries = await getCollection('blog');
    expect(entries).toHaveLength(3);
    // Defaults should be applied
    expect(entries.every((e) => typeof e.data.draft === 'boolean')).toBe(true);
  });

  it('throws on schema validation failure', async () => {
    // Write a file that violates the schema
    await writeFile(
      join(tmpDir, 'blog', 'bad.md'),
      `---
title: 123
---
Bad content`,
    );

    createContent({ contentDir: tmpDir });
    defineCollection({
      name: 'blog',
      directory: 'blog',
      schema: {
        title: { type: 'string', required: true },
      },
    });
    await expect(getCollection('blog')).rejects.toThrow('Validation error');
  });

  it('lists registered collections', () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    defineCollection({ name: 'pages', directory: 'pages' });
    expect(listCollections()).toEqual(['blog', 'pages']);
  });
});

// ---------------------------------------------------------------------------
// MCP Content Server
// ---------------------------------------------------------------------------

describe('createContentMCPServer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-mcp-'));
    const blogDir = join(tmpDir, 'blog');
    await mkdir(blogDir, { recursive: true });

    await writeFile(
      join(blogDir, 'hello.md'),
      `---
title: Hello MCP
date: 2026-01-01
tags:
  - test
  - mcp
draft: false
---

Hello from MCP.`,
    );

    await writeFile(
      join(blogDir, 'draft-post.md'),
      `---
title: Draft Post
date: 2026-02-01
tags:
  - draft
draft: true
---

This is a draft.`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createServer() {
    return createContentMCPServer({
      contentDir: tmpDir,
      collections: [{ name: 'blog', directory: 'blog' }],
    });
  }

  function rpc(method: string, params?: Record<string, unknown>) {
    return { jsonrpc: '2.0' as const, id: 1, method, params };
  }

  it('responds to initialize', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('initialize'));
    expect(res.result).toHaveProperty('protocolVersion');
    expect(res.result).toHaveProperty('capabilities');
  });

  it('lists tools', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('tools/list'));
    const tools = (res.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(9);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_collections');
    expect(names).toContain('list_entries');
    expect(names).toContain('get_entry');
    expect(names).toContain('create_entry');
    expect(names).toContain('update_entry');
    expect(names).toContain('delete_entry');
    expect(names).toContain('search_entries');
    expect(names).toContain('list_tags');
    expect(names).toContain('publish_entry');
  });

  it('lists collections', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'list_collections',
        arguments: {},
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.collections).toEqual(['blog']);
  });

  it('lists entries', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'list_entries',
        arguments: { collection: 'blog' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.count).toBe(2);
  });

  it('filters entries by tag', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'list_entries',
        arguments: { collection: 'blog', tag: 'mcp' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.count).toBe(1);
    expect(result.entries[0].title).toBe('Hello MCP');
  });

  it('filters entries by draft status', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'list_entries',
        arguments: { collection: 'blog', draft: 'true' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.count).toBe(1);
    expect(result.entries[0].title).toBe('Draft Post');
  });

  it('gets a single entry', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'hello' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.data.title).toBe('Hello MCP');
    expect(result.html).toContain('Hello from MCP');
  });

  it('returns error for missing entry', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'missing' },
      }),
    );
    const result = res.result as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('creates a new entry', async () => {
    const server = createServer();
    await server.handleRequest(
      rpc('tools/call', {
        name: 'create_entry',
        arguments: {
          collection: 'blog',
          slug: 'new-post',
          data: { title: 'New Post', date: '2026-03-01' },
          body: 'New content here.',
        },
      }),
    );

    // Verify it was created
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'new-post' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.data.title).toBe('New Post');
  });

  it('updates an entry', async () => {
    const server = createServer();
    await server.handleRequest(
      rpc('tools/call', {
        name: 'update_entry',
        arguments: {
          collection: 'blog',
          slug: 'hello',
          data: { title: 'Updated Title' },
        },
      }),
    );

    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'hello' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.data.title).toBe('Updated Title');
  });

  it('deletes an entry', async () => {
    const server = createServer();
    await server.handleRequest(
      rpc('tools/call', {
        name: 'delete_entry',
        arguments: { collection: 'blog', slug: 'hello' },
      }),
    );

    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'hello' },
      }),
    );
    const result = res.result as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('searches entries by text', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'search_entries',
        arguments: { collection: 'blog', query: 'MCP' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it('lists tags', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'list_tags',
        arguments: { collection: 'blog' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.tags).toContain('test');
    expect(result.tags).toContain('mcp');
    expect(result.tags).toContain('draft');
  });

  it('publishes a draft entry', async () => {
    const server = createServer();
    await server.handleRequest(
      rpc('tools/call', {
        name: 'publish_entry',
        arguments: { collection: 'blog', slug: 'draft-post' },
      }),
    );

    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'draft-post' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.data.draft).toBe(false);
  });

  it('returns error for unknown tool', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'nonexistent_tool',
        arguments: {},
      }),
    );
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32602);
  });

  it('returns error for unknown collection', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'list_entries',
        arguments: { collection: 'nonexistent' },
      }),
    );
    expect(res.error).toBeDefined();
  });

  it('lists resources', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('resources/list'));
    const resources = (res.result as { resources: Array<{ uri: string }> }).resources;
    expect(resources.some((r) => r.uri === 'content://blog')).toBe(true);
  });

  it('reads a collection resource', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('resources/read', { uri: 'content://blog' }));
    const contents = (res.result as { contents: Array<{ text: string }> }).contents;
    const data = JSON.parse(contents[0].text);
    expect(data).toHaveLength(2);
  });

  it('reads a single entry resource', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('resources/read', { uri: 'content://blog/hello' }));
    const contents = (res.result as { contents: Array<{ text: string }> }).contents;
    const data = JSON.parse(contents[0].text);
    expect(data.data.title).toBe('Hello MCP');
  });

  it('responds to ping', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('ping'));
    expect(res.result).toEqual({});
  });

  it('returns error for unknown method', async () => {
    const server = createServer();
    const res = await server.handleRequest(rpc('unknown/method'));
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });

  it('returns server info', () => {
    const server = createServer();
    const info = server.info();
    expect(info.name).toBe('utopia-content');
    expect(info.version).toBe('0.6.0');
  });

  it('creates an entry then finds it via search', async () => {
    const server = createServer();
    await server.handleRequest(
      rpc('tools/call', {
        name: 'create_entry',
        arguments: {
          collection: 'blog',
          slug: 'searchable',
          data: { title: 'UniqueSearchToken42', date: '2026-04-01' },
          body: 'This post contains UniqueSearchToken42 in the body.',
        },
      }),
    );

    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'search_entries',
        arguments: { collection: 'blog', query: 'UniqueSearchToken42' },
      }),
    );
    const result = JSON.parse((res.result as { content: Array<{ text: string }> }).content[0].text);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.entries.some((e: { slug: string }) => e.slug === 'searchable')).toBe(true);
  });

  it('updates data without losing the body', async () => {
    const server = createServer();

    // Read original body
    const before = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'hello' },
      }),
    );
    const beforeResult = JSON.parse(
      (before.result as { content: Array<{ text: string }> }).content[0].text,
    );
    const originalBody = beforeResult.body;

    // Update only data (no body param)
    await server.handleRequest(
      rpc('tools/call', {
        name: 'update_entry',
        arguments: {
          collection: 'blog',
          slug: 'hello',
          data: { title: 'Title Changed' },
        },
      }),
    );

    // Read back and verify body is preserved
    const after = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 'hello' },
      }),
    );
    const afterResult = JSON.parse(
      (after.result as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(afterResult.data.title).toBe('Title Changed');
    expect(afterResult.body).toContain('Hello from MCP');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — filesystem adapter
// ---------------------------------------------------------------------------

describe('createFilesystemAdapter — edge cases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-edge-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses .utopia files with metadata export', async () => {
    const colDir = join(tmpDir, 'components');
    await mkdir(colDir, { recursive: true });
    await writeFile(
      join(colDir, 'card.utopia'),
      `<script>
export const metadata = {"title": "Card Component", "version": 2};
</script>

<template>
  <div class="card">{{ title }}</div>
</template>

<style>
.card { padding: 1rem; }
</style>`,
    );

    const adapter = createFilesystemAdapter(tmpDir);
    const config = { name: 'components', directory: 'components', formats: ['utopia' as const] };
    const entry = await adapter.readEntry(config, 'card');

    expect(entry).not.toBeNull();
    expect(entry!.format).toBe('utopia');
    expect(entry!.data.title).toBe('Card Component');
    expect(entry!.data.version).toBe(2);
  });

  it('parses .yaml files', async () => {
    const colDir = join(tmpDir, 'data');
    await mkdir(colDir, { recursive: true });
    await writeFile(
      join(colDir, 'config.yaml'),
      `title: Site Config
debug: true
ports:
  - 3000
  - 8080`,
    );

    const adapter = createFilesystemAdapter(tmpDir);
    const config = { name: 'data', directory: 'data', formats: ['yaml' as const] };
    const entry = await adapter.readEntry(config, 'config');

    expect(entry).not.toBeNull();
    expect(entry!.format).toBe('yaml');
    expect(entry!.data.title).toBe('Site Config');
    expect(entry!.data.debug).toBe(true);
    expect(entry!.data.ports).toEqual([3000, 8080]);
  });

  it('survives a write-then-read roundtrip', async () => {
    const colDir = join(tmpDir, 'roundtrip');
    await mkdir(colDir, { recursive: true });

    const adapter = createFilesystemAdapter(tmpDir);
    const config = { name: 'roundtrip', directory: 'roundtrip', formats: ['md' as const] };

    const originalData = {
      title: 'Roundtrip Test',
      count: 99,
      draft: false,
      tags: ['alpha', 'beta'],
    };
    const originalBody = '# Roundtrip\n\nAll data should survive.';

    await adapter.writeEntry(config, 'trip', originalData, originalBody, 'md');
    const entry = await adapter.readEntry(config, 'trip');

    expect(entry).not.toBeNull();
    expect(entry!.data.title).toBe('Roundtrip Test');
    expect(entry!.data.count).toBe(99);
    expect(entry!.data.draft).toBe(false);
    expect(entry!.data.tags).toEqual(['alpha', 'beta']);
    expect(entry!.body).toContain('# Roundtrip');
    expect(entry!.body).toContain('All data should survive.');
    expect(entry!.html).toContain('<h1 id="roundtrip">Roundtrip</h1>');
  });

  it('writes and reads YAML files correctly', async () => {
    const colDir = join(tmpDir, 'yamlcol');
    await mkdir(colDir, { recursive: true });

    const adapter = createFilesystemAdapter(tmpDir);
    const config = { name: 'yamlcol', directory: 'yamlcol', formats: ['yaml' as const] };

    await adapter.writeEntry(
      config,
      'settings',
      { title: 'My Settings', debug: true, port: 3000 },
      '',
      'yaml',
    );
    const entry = await adapter.readEntry(config, 'settings');

    expect(entry).not.toBeNull();
    expect(entry!.format).toBe('yaml');
    expect(entry!.data.title).toBe('My Settings');
    expect(entry!.data.debug).toBe(true);
    expect(entry!.data.port).toBe(3000);
  });

  it('writes and reads JSON files correctly', async () => {
    const colDir = join(tmpDir, 'jsoncol');
    await mkdir(colDir, { recursive: true });

    const adapter = createFilesystemAdapter(tmpDir);
    const config = { name: 'jsoncol', directory: 'jsoncol', formats: ['json' as const] };

    await adapter.writeEntry(
      config,
      'item',
      { name: 'Widget', price: 9.99, active: true },
      '',
      'json',
    );
    const entry = await adapter.readEntry(config, 'item');

    expect(entry).not.toBeNull();
    expect(entry!.format).toBe('json');
    expect(entry!.data.name).toBe('Widget');
    expect(entry!.data.price).toBe(9.99);
    expect(entry!.data.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — collection engine
// ---------------------------------------------------------------------------

describe('collection engine — edge cases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    clearCollections();
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-col-edge-'));
  });

  afterEach(async () => {
    clearCollections();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array for a collection with no files', async () => {
    const emptyDir = join(tmpDir, 'empty');
    await mkdir(emptyDir, { recursive: true });

    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'empty', directory: 'empty' });
    const entries = await getCollection('empty');
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — schema
// ---------------------------------------------------------------------------

describe('validateSchema — edge cases', () => {
  it('ignores extra fields not defined in the schema', () => {
    const schema: CollectionSchema = {
      title: { type: 'string', required: true },
    };
    const errors = validateSchema(
      { title: 'Hello', extraField: 'should be ignored', anotherExtra: 42 },
      schema,
    );
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — markdown
// ---------------------------------------------------------------------------

describe('renderMarkdown — edge cases', () => {
  it('handles empty string input without crashing', async () => {
    const html = await renderMarkdown('');
    expect(typeof html).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — frontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter — edge cases', () => {
  it('parses frontmatter with empty body', () => {
    const result = parseFrontmatter(`---
title: No Body
draft: true
---
`);
    expect(result.data.title).toBe('No Body');
    expect(result.data.draft).toBe(true);
    expect(result.body.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Security — slug validation and safe metadata
// ---------------------------------------------------------------------------

import { validateSlug } from './adapters/filesystem.js';

describe('Security — slug validation', () => {
  it('rejects path traversal with ../', () => {
    expect(() => validateSlug('../secret')).toThrow('Invalid slug');
  });

  it('rejects deep path traversal', () => {
    expect(() => validateSlug('../../etc/passwd')).toThrow('Invalid slug');
  });

  it('rejects backslash traversal', () => {
    expect(() => validateSlug('..\\..\\secret')).toThrow('Invalid slug');
  });

  it('rejects traversal in the middle of a slug', () => {
    expect(() => validateSlug('foo/../bar')).toThrow('Invalid slug');
  });

  it('rejects double slashes', () => {
    expect(() => validateSlug('//double-slash')).toThrow('Invalid slug');
  });

  it('rejects empty slug', () => {
    expect(() => validateSlug('')).toThrow('Invalid slug');
  });

  it('accepts simple slugs', () => {
    expect(() => validateSlug('hello')).not.toThrow();
  });

  it('accepts nested path slugs', () => {
    expect(() => validateSlug('nested/path')).not.toThrow();
  });

  it('accepts slugs with numbers and hyphens', () => {
    expect(() => validateSlug('my-post-123')).not.toThrow();
  });
});

describe('Security — extractUtopiaMetadata', () => {
  it('returns {} for JS expressions in metadata (not valid JSON)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'utopia-sec-'));
    const colDir = join(tmpDir, 'comps');
    await mkdir(colDir, { recursive: true });
    await writeFile(
      join(colDir, 'evil.utopia'),
      `<script>
export const metadata = { title: process.env.SECRET || "hacked" };
</script>
<template><div></div></template>`,
    );

    const adapter = createFilesystemAdapter(tmpDir);
    const entry = await adapter.readEntry(
      { name: 'comps', directory: 'comps', formats: ['utopia' as const] },
      'evil',
    );
    expect(entry).not.toBeNull();
    // Should return empty object since the metadata is not valid JSON
    expect(entry!.data).toEqual({});
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses valid JSON metadata correctly', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'utopia-sec-'));
    const colDir = join(tmpDir, 'comps');
    await mkdir(colDir, { recursive: true });
    await writeFile(
      join(colDir, 'good.utopia'),
      `<script>
export const metadata = {"title": "Good Component", "version": 2};
</script>
<template><div></div></template>`,
    );

    const adapter = createFilesystemAdapter(tmpDir);
    const entry = await adapter.readEntry(
      { name: 'comps', directory: 'comps', formats: ['utopia' as const] },
      'good',
    );
    expect(entry).not.toBeNull();
    expect(entry!.data.title).toBe('Good Component');
    expect(entry!.data.version).toBe(2);
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe('Security — filesystem adapter rejects traversal slugs', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-sec-fs-'));
    const blogDir = join(tmpDir, 'blog');
    await mkdir(blogDir, { recursive: true });
    await writeFile(join(blogDir, 'hello.md'), '---\ntitle: Hello\n---\nHello');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const blogConfig = { name: 'blog', directory: 'blog' };

  it('readEntry rejects traversal slug', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await expect(adapter.readEntry(blogConfig, '../etc/passwd')).rejects.toThrow('Invalid slug');
  });

  it('writeEntry rejects traversal slug', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await expect(
      adapter.writeEntry(blogConfig, '../evil', { title: 'bad' }, 'body'),
    ).rejects.toThrow('Invalid slug');
  });

  it('updateEntry rejects traversal slug', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await expect(adapter.updateEntry(blogConfig, '../evil', { title: 'bad' })).rejects.toThrow(
      'Invalid slug',
    );
  });

  it('deleteEntry rejects traversal slug', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await expect(adapter.deleteEntry(blogConfig, '../evil')).rejects.toThrow('Invalid slug');
  });
});

describe('Security — MCP tool input validation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-sec-mcp-'));
    const blogDir = join(tmpDir, 'blog');
    await mkdir(blogDir, { recursive: true });
    await writeFile(join(blogDir, 'hello.md'), '---\ntitle: Hello\n---\nHello');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function createServer() {
    return createContentMCPServer({
      contentDir: tmpDir,
      collections: [{ name: 'blog', directory: 'blog' }],
    });
  }

  function rpc(method: string, params?: Record<string, unknown>) {
    return { jsonrpc: '2.0' as const, id: 1, method, params };
  }

  it('get_entry rejects traversal slug via MCP', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: '../etc/passwd' },
      }),
    );
    expect(res.error).toBeDefined();
  });

  it('create_entry rejects traversal slug via MCP', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'create_entry',
        arguments: { collection: 'blog', slug: '../evil', body: 'x' },
      }),
    );
    expect(res.error).toBeDefined();
  });

  it('get_entry rejects non-string slug', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'get_entry',
        arguments: { collection: 'blog', slug: 123 },
      }),
    );
    expect(res.error).toBeDefined();
  });

  it('search_entries rejects non-string query', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('tools/call', {
        name: 'search_entries',
        arguments: { collection: 'blog', query: 42 },
      }),
    );
    expect(res.error).toBeDefined();
  });

  it('resource URI with traversal slug is rejected', async () => {
    const server = createServer();
    const res = await server.handleRequest(
      rpc('resources/read', { uri: 'content://blog/../etc/passwd' }),
    );
    expect(res.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Virtual adapter
// ---------------------------------------------------------------------------

describe('createVirtualAdapter', () => {
  const collections = {
    blog: [
      {
        slug: 'hello-world',
        data: { title: 'Hello World', date: '2026-01-01', tags: ['intro'] },
        body: '# Hello\n\nThis is a test.',
        html: '<h1>Hello</h1>\n<p>This is a test.</p>',
      },
      {
        slug: 'second-post',
        data: { title: 'Second Post', date: '2026-02-01' },
        body: 'Body text',
      },
    ],
    notes: [{ slug: 'note-one', data: { title: 'Note One' } }],
  };

  const blogConfig = { name: 'blog', directory: 'blog' };
  const notesConfig = { name: 'notes', directory: 'notes' };
  const emptyConfig = { name: 'nonexistent', directory: 'nonexistent' };

  it('readEntries returns all entries for a collection', async () => {
    const adapter = createVirtualAdapter(collections);
    const entries = await adapter.readEntries(blogConfig);
    expect(entries).toHaveLength(2);
    expect(entries[0].slug).toBe('hello-world');
    expect(entries[0].data.title).toBe('Hello World');
    expect(entries[0].html).toBe('<h1>Hello</h1>\n<p>This is a test.</p>');
    expect(entries[0].body).toBe('# Hello\n\nThis is a test.');
    expect(entries[0].collection).toBe('blog');
    expect(entries[0].filePath).toBe('virtual:blog/hello-world');
  });

  it('readEntries returns empty array for unknown collection', async () => {
    const adapter = createVirtualAdapter(collections);
    const entries = await adapter.readEntries(emptyConfig);
    expect(entries).toEqual([]);
  });

  it('readEntry returns a single entry by slug', async () => {
    const adapter = createVirtualAdapter(collections);
    const entry = await adapter.readEntry(blogConfig, 'second-post');
    expect(entry).not.toBeNull();
    expect(entry!.slug).toBe('second-post');
    expect(entry!.data.title).toBe('Second Post');
    expect(entry!.body).toBe('Body text');
    expect(entry!.html).toBeUndefined();
  });

  it('readEntry returns null for missing slug', async () => {
    const adapter = createVirtualAdapter(collections);
    const entry = await adapter.readEntry(blogConfig, 'nonexistent');
    expect(entry).toBeNull();
  });

  it('readEntry returns null for missing collection', async () => {
    const adapter = createVirtualAdapter(collections);
    const entry = await adapter.readEntry(emptyConfig, 'hello-world');
    expect(entry).toBeNull();
  });

  it('listSlugs returns slugs for a collection', async () => {
    const adapter = createVirtualAdapter(collections);
    const slugs = await adapter.listSlugs(blogConfig);
    expect(slugs).toEqual(['hello-world', 'second-post']);
  });

  it('listSlugs returns empty array for unknown collection', async () => {
    const adapter = createVirtualAdapter(collections);
    const slugs = await adapter.listSlugs(emptyConfig);
    expect(slugs).toEqual([]);
  });

  it('writeEntry throws read-only error', async () => {
    const adapter = createVirtualAdapter(collections);
    await expect(adapter.writeEntry(blogConfig, 'test', {}, '')).rejects.toThrow('read-only');
  });

  it('updateEntry throws read-only error', async () => {
    const adapter = createVirtualAdapter(collections);
    await expect(adapter.updateEntry(blogConfig, 'test')).rejects.toThrow('read-only');
  });

  it('deleteEntry throws read-only error', async () => {
    const adapter = createVirtualAdapter(collections);
    await expect(adapter.deleteEntry(blogConfig, 'test')).rejects.toThrow('read-only');
  });

  it('works with collection engine', async () => {
    clearCollections();
    const adapter = createVirtualAdapter(collections);
    createContent({ contentDir: '/virtual', adapter });
    defineCollection({ name: 'notes', directory: 'notes' });

    const entries = await getCollection('notes');
    expect(entries).toHaveLength(1);
    expect(entries[0].data.title).toBe('Note One');
    clearCollections();
  });
});

// ---------------------------------------------------------------------------
// Security — CDATA injection (SEC-0003)
// ---------------------------------------------------------------------------

describe('Security — CDATA injection in feed generation', () => {
  const feedOptions: FeedOptions = {
    title: 'Blog',
    description: 'desc',
    siteUrl: 'https://example.com',
  };

  it('RSS: ]]> in entry.html is escaped and does not break out of CDATA', () => {
    const entry: FeedEntry = {
      slug: 'test',
      title: 'Test',
      date: '2026-01-01T00:00:00Z',
      html: 'before]]>after',
      url: 'https://example.com/test',
    };
    const rss = generateRssFeed([entry], feedOptions);
    // The raw terminator must not appear verbatim inside the encoded element
    expect(rss).not.toContain('<![CDATA[before]]>after]]>');
    // The escaped split form must be present instead
    expect(rss).toContain('<![CDATA[before]]]]><![CDATA[>after]]>');
  });

  it('RSS: ]]> in entry.html is replaced with the CDATA split sequence', () => {
    const entry: FeedEntry = {
      slug: 'inject',
      title: 'Inject',
      date: '2026-01-01T00:00:00Z',
      html: 'a]]>b',
      url: 'https://example.com/inject',
    };
    const rss = generateRssFeed([entry], feedOptions);
    // The escaped split form must be present
    expect(rss).toContain('a]]]]><![CDATA[>b');
    // The raw sequence must not appear as a premature CDATA terminator
    // (i.e., <![CDATA[a]]> must not appear — only <![CDATA[a]]]]><![CDATA[>b]]>)
    expect(rss).not.toContain('<![CDATA[a]]>');
  });

  it('Atom: ]]> in entry.html is escaped and does not break out of CDATA', () => {
    const entry: FeedEntry = {
      slug: 'test',
      title: 'Test',
      date: '2026-01-01T00:00:00Z',
      html: 'before]]>after',
      url: 'https://example.com/test',
    };
    const atom = generateAtomFeed([entry], feedOptions);
    expect(atom).not.toContain('<![CDATA[before]]>after]]>');
    expect(atom).toContain('<![CDATA[before]]]]><![CDATA[>after]]>');
  });

  it('Atom: ]]> in entry.html is replaced with the CDATA split sequence', () => {
    const entry: FeedEntry = {
      slug: 'inject',
      title: 'Inject',
      date: '2026-01-01T00:00:00Z',
      html: 'a]]>b',
      url: 'https://example.com/inject',
    };
    const atom = generateAtomFeed([entry], feedOptions);
    expect(atom).toContain('a]]]]><![CDATA[>b');
    expect(atom).not.toContain('<![CDATA[a]]>');
  });

  it('normal HTML without ]]> is passed through unchanged', () => {
    const entry: FeedEntry = {
      slug: 'normal',
      title: 'Normal',
      date: '2026-01-01T00:00:00Z',
      html: '<p>Hello <strong>world</strong></p>',
      url: 'https://example.com/normal',
    };
    const rss = generateRssFeed([entry], feedOptions);
    expect(rss).toContain('<![CDATA[<p>Hello <strong>world</strong></p>]]>');
  });
});

// ---------------------------------------------------------------------------
// Feed generation
// ---------------------------------------------------------------------------

describe('generateRssFeed', () => {
  const feedOptions: FeedOptions = {
    title: 'Test Blog',
    description: 'A test blog',
    siteUrl: 'https://example.com',
    feedUrl: 'https://example.com/feed.xml',
    language: 'en',
    author: 'Test Author',
    copyright: '2026 Test',
  };

  const entries: FeedEntry[] = [
    {
      slug: 'hello',
      title: 'Hello World',
      description: 'First post',
      date: '2026-01-15T00:00:00Z',
      html: '<p>Hello!</p>',
      url: 'https://example.com/blog/hello',
      tags: ['intro', 'test'],
    },
    {
      slug: 'second',
      title: 'Second Post',
      date: '2026-02-01T00:00:00Z',
      url: 'https://example.com/blog/second',
    },
  ];

  it('generates valid RSS 2.0 XML', () => {
    const rss = generateRssFeed(entries, feedOptions);
    expect(rss).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain('<title>Test Blog</title>');
    expect(rss).toContain('<description>A test blog</description>');
    expect(rss).toContain('<link>https://example.com</link>');
    expect(rss).toContain('<language>en</language>');
    expect(rss).toContain('<copyright>2026 Test</copyright>');
  });

  it('includes feed entries with correct structure', () => {
    const rss = generateRssFeed(entries, feedOptions);
    expect(rss).toContain('<title>Hello World</title>');
    expect(rss).toContain('<link>https://example.com/blog/hello</link>');
    expect(rss).toContain('<guid isPermaLink="true">https://example.com/blog/hello</guid>');
    expect(rss).toContain('<description>First post</description>');
    expect(rss).toContain('<content:encoded><![CDATA[<p>Hello!</p>]]></content:encoded>');
    expect(rss).toContain('<category>intro</category>');
    expect(rss).toContain('<category>test</category>');
  });

  it('handles entries without optional fields', () => {
    const rss = generateRssFeed(entries, feedOptions);
    expect(rss).toContain('<title>Second Post</title>');
    // Second entry should not have description or content:encoded
    const secondItemStart = rss.indexOf('<title>Second Post</title>');
    const secondItemEnd = rss.indexOf('</item>', secondItemStart);
    const secondItem = rss.slice(secondItemStart, secondItemEnd);
    expect(secondItem).not.toContain('<description>');
    expect(secondItem).not.toContain('<content:encoded>');
  });

  it('includes atom:link self reference', () => {
    const rss = generateRssFeed(entries, feedOptions);
    expect(rss).toContain('atom:link href="https://example.com/feed.xml" rel="self"');
  });

  it('escapes XML special characters', () => {
    const rss = generateRssFeed(
      [
        {
          slug: 'test',
          title: 'A & B <> "quotes"',
          date: '2026-01-01T00:00:00Z',
          url: 'https://example.com/blog/test',
        },
      ],
      feedOptions,
    );
    expect(rss).toContain('A &amp; B &lt;&gt; &quot;quotes&quot;');
  });

  it('works with empty entries', () => {
    const rss = generateRssFeed([], feedOptions);
    expect(rss).toContain('<channel>');
    expect(rss).toContain('</channel>');
    expect(rss).not.toContain('<item>');
  });
});

describe('generateAtomFeed', () => {
  const feedOptions: FeedOptions = {
    title: 'Test Blog',
    description: 'A test blog',
    siteUrl: 'https://example.com',
    feedUrl: 'https://example.com/atom.xml',
    author: 'Test Author',
  };

  const entries: FeedEntry[] = [
    {
      slug: 'hello',
      title: 'Hello World',
      description: 'First post',
      date: '2026-01-15T00:00:00Z',
      html: '<p>Hello!</p>',
      url: 'https://example.com/blog/hello',
      tags: ['intro'],
    },
  ];

  it('generates valid Atom 1.0 XML', () => {
    const atom = generateAtomFeed(entries, feedOptions);
    expect(atom).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(atom).toContain('<title>Test Blog</title>');
    expect(atom).toContain('<subtitle>A test blog</subtitle>');
  });

  it('includes author element', () => {
    const atom = generateAtomFeed(entries, feedOptions);
    expect(atom).toContain('<author>');
    expect(atom).toContain('<name>Test Author</name>');
  });

  it('includes entry with correct structure', () => {
    const atom = generateAtomFeed(entries, feedOptions);
    expect(atom).toContain('<title>Hello World</title>');
    expect(atom).toContain('<link href="https://example.com/blog/hello"/>');
    expect(atom).toContain('<id>https://example.com/blog/hello</id>');
    expect(atom).toContain('<summary>First post</summary>');
    expect(atom).toContain('<content type="html"><![CDATA[<p>Hello!</p>]]></content>');
    expect(atom).toContain('<category term="intro"/>');
  });

  it('includes self link', () => {
    const atom = generateAtomFeed(entries, feedOptions);
    expect(atom).toContain('href="https://example.com/atom.xml" rel="self"');
  });
});
