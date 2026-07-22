// targeted unit tests for branches missed by the main suites: markdown custom
// plugins, schema date validation, feed optionals, collection engine paths,
// filesystem utopia writes, and mcp filters.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderMarkdown } from './markdown';
import { validateSchema } from './schema';
import { generateAtomFeed, generateRssFeed } from './feed';
import { createFilesystemAdapter } from './adapters/filesystem';
import { createVirtualAdapter } from './adapters/virtual';
import {
  createContent,
  defineCollection,
  getCollection,
  getEntry,
  clearCollections,
} from './collection';
import { createContentMCPServer } from './mcp/index';
import type { FeedOptions } from './feed';

const SCRATCH = '/tmp/claude-0/-home-user-utopiajs/4e9c47cd-38d7-56cd-a2c6-8bddac297eab/scratchpad';

// ---------------------------------------------------------------------------
// markdown — custom plugin pipeline
// ---------------------------------------------------------------------------

function visit(node: any, fn: (node: any) => void): void {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

function remarkUppercase() {
  return (tree: any) => {
    visit(tree, (node) => {
      if (node.type === 'text') node.value = node.value.toUpperCase();
    });
  };
}

function remarkReplace(options: { from: string; to: string }) {
  return (tree: any) => {
    visit(tree, (node) => {
      if (node.type === 'text') node.value = node.value.replaceAll(options.from, options.to);
    });
  };
}

function rehypeAddClass(options: { className: string } = { className: 'default-class' }) {
  return (tree: any) => {
    visit(tree, (node) => {
      if (node.tagName === 'h1') {
        node.properties = { ...node.properties, className: [options.className] };
      }
    });
  };
}

describe('renderMarkdown — custom plugins', () => {
  it('applies a bare remark plugin', async () => {
    const html = await renderMarkdown('# hello world', { remarkPlugins: [remarkUppercase] });
    expect(html).toContain('HELLO WORLD');
  });

  it('applies a [plugin, options] remark tuple', async () => {
    const html = await renderMarkdown('# hello world', {
      remarkPlugins: [[remarkReplace, { from: 'world', to: 'planet' }]],
    });
    expect(html).toContain('hello planet');
  });

  it('applies bare and tuple rehype plugins', async () => {
    const bare = await renderMarkdown('# hi', { rehypePlugins: [rehypeAddClass] });
    expect(bare).toContain('class="default-class"');

    const tuple = await renderMarkdown('# hi', {
      rehypePlugins: [[rehypeAddClass, { className: 'from-options' }]],
    });
    expect(tuple).toContain('class="from-options"');
  });

  it('supports custom plugins with highlighting disabled', async () => {
    const html = await renderMarkdown('# hi\n\n```\ncode\n```', {
      remarkPlugins: [remarkUppercase],
      highlight: false,
    });
    expect(html).toContain('HI');
    expect(html).toContain('<code>');
    expect(html).not.toContain('hljs');
  });

  it('keeps slug ids in the custom-plugin pipeline', async () => {
    const html = await renderMarkdown('# My Title', { remarkPlugins: [remarkUppercase] });
    expect(html).toContain('id="my-title"');
  });

  it('applies highlighting in the custom-plugin pipeline', async () => {
    const html = await renderMarkdown('```js\nconst x = 1;\n```', {
      remarkPlugins: [remarkUppercase],
    });
    expect(html).toContain('language-js');
  });
});

// ---------------------------------------------------------------------------
// schema — date branch
// ---------------------------------------------------------------------------

describe('validateSchema — date type edge', () => {
  it('rejects a non-string, non-Date date value', () => {
    const errors = validateSchema({ when: 12345 }, { when: { type: 'date' } });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('date or date string');
  });
});

describe('validateSchema — array without items', () => {
  it('accepts any element types when items is unspecified', () => {
    const errors = validateSchema({ list: ['a', 1, true] }, { list: { type: 'array' } });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// feed — optional field branches
// ---------------------------------------------------------------------------

describe('feed — optional fields', () => {
  const options: FeedOptions = {
    title: 'T',
    description: 'D',
    siteUrl: 'https://example.test',
  };

  it('atom entry without tags/description/html has no category, summary or content', () => {
    const atom = generateAtomFeed(
      [{ slug: 's', title: 'Bare', date: '2026-01-01', url: 'https://example.test/s' }],
      options,
    );
    expect(atom).not.toContain('<category');
    expect(atom).not.toContain('<summary>');
    expect(atom).not.toContain('<content');
    expect(atom).not.toContain('<author>');
    expect(atom).not.toContain('rel="self"');
  });

  it('rss without feedUrl or copyright omits the optional channel elements', () => {
    const rss = generateRssFeed([], options);
    expect(rss).not.toContain('rel="self"');
    expect(rss).not.toContain('<copyright>');
    expect(rss).toContain('<language>en</language>');
  });
});

// ---------------------------------------------------------------------------
// collection engine — getEntry schema paths and nested sorting
// ---------------------------------------------------------------------------

describe('collection engine — schema on getEntry and nested sort', () => {
  let tmpDir: string;

  beforeEach(async () => {
    clearCollections();
    await mkdir(SCRATCH, { recursive: true });
    tmpDir = await mkdtemp(join(SCRATCH, 'col-misc-'));
    const blog = join(tmpDir, 'blog');
    await mkdir(blog, { recursive: true });
    await writeFile(join(blog, 'good.md'), '---\ntitle: Good\nauthor:\n  name: Zoe\n---\nBody');
    await writeFile(join(blog, 'other.md'), '---\ntitle: Other\nauthor:\n  name: Adam\n---\nBody');
  });

  afterEach(async () => {
    clearCollections();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('getEntry applies defaults and validates against the schema', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({
      name: 'blog',
      directory: 'blog',
      schema: {
        title: { type: 'string', required: true },
        draft: { type: 'boolean', default: false },
      },
    });
    const entry = await getEntry('blog', 'good');
    expect(entry!.data.draft).toBe(false);
  });

  it('getEntry throws on schema validation failure', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({
      name: 'blog',
      directory: 'blog',
      schema: { missing: { type: 'string', required: true } },
    });
    await expect(getEntry('blog', 'good')).rejects.toThrow('Validation error');
  });

  it('getEntry throws for an undefined collection', async () => {
    await expect(getEntry('nope', 'slug')).rejects.toThrow('not defined');
  });

  it('sorts by a nested dot-path field', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', { sort: 'author.name' });
    expect(entries.map((e) => e.data.title)).toEqual(['Other', 'Good']);
  });

  it('treats a dot-path through a non-object as undefined when sorting', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    // title is a string, so title.x.y traverses into a non-object
    const entries = await getCollection('blog', { sort: 'title.x.y' });
    expect(entries).toHaveLength(2);
  });

  it('sorts descending when the first entry compares lower', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', { sort: 'title', order: 'desc' });
    expect(entries.map((e) => e.data.title)).toEqual(['Other', 'Good']);
  });

  it('leaves order stable for entries with equal sort values', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    // both entries lack this field entirely → comparator returns 0
    const entries = await getCollection('blog', { sort: 'nonexistent' });
    expect(entries).toHaveLength(2);
  });

  it('defineCollection works without createContent (cwd-relative adapter)', async () => {
    // no createContent call: the collection falls back to a filesystem adapter
    // with no base dir, resolving the directory as given
    defineCollection({ name: 'standalone', directory: join(tmpDir, 'blog') });
    const entries = await getCollection('standalone');
    expect(entries).toHaveLength(2);
  });
});

describe('collection engine — sort comparator directions', () => {
  afterEach(() => clearCollections());

  it('hits both comparison directions for asc and desc', async () => {
    const adapter = createVirtualAdapter({
      posts: [
        { slug: 'b', data: { title: 'B' } },
        { slug: 'a', data: { title: 'A' } },
        { slug: 'c', data: { title: 'C' } },
      ],
    });
    createContent({ contentDir: '/virtual', adapter });
    defineCollection({ name: 'posts', directory: 'posts' });

    const asc = await getCollection('posts', { sort: 'title', order: 'asc' });
    expect(asc.map((e) => e.data.title)).toEqual(['A', 'B', 'C']);

    const desc = await getCollection('posts', { sort: 'title', order: 'desc' });
    expect(desc.map((e) => e.data.title)).toEqual(['C', 'B', 'A']);
  });
});

// ---------------------------------------------------------------------------
// filesystem adapter — utopia format write path
// ---------------------------------------------------------------------------

describe('filesystem adapter — utopia writes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(SCRATCH, 'fs-utopia-'));
    await mkdir(join(tmpDir, 'comps'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes the raw body for utopia files (metadata lives in the body)', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const config = { name: 'comps', directory: 'comps' };
    const body =
      '<script>\nexport const metadata = {"title": "Widget"};\n</script>\n<template><div/></template>';
    await adapter.writeEntry(config, 'widget', {}, body, 'utopia');

    const raw = await readFile(join(tmpDir, 'comps', 'widget.utopia'), 'utf-8');
    expect(raw).toBe(body);

    const entry = await adapter.readEntry(config, 'widget');
    expect(entry!.format).toBe('utopia');
    expect(entry!.data.title).toBe('Widget');
  });
});

// ---------------------------------------------------------------------------
// mcp — remaining filter branches
// ---------------------------------------------------------------------------

describe('mcp — list_entries draft filter and default arguments', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(SCRATCH, 'mcp-misc-'));
    const blog = join(tmpDir, 'blog');
    await mkdir(blog, { recursive: true });
    await writeFile(join(blog, 'live.md'), '---\ntitle: Live\ndraft: false\n---\nLive');
    await writeFile(join(blog, 'wip.md'), '---\ntitle: WIP\ndraft: true\n---\nWip');
    // an entry with no title and no tags exercises the fallback branches in
    // search_entries and list_tags
    await writeFile(join(blog, 'untitled.md'), 'plain body with needle-token');
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

  it('filters out drafts with draft: "false"', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_entries', arguments: { collection: 'blog', draft: 'false' } },
    });
    const result = JSON.parse((res.result as any).content[0].text);
    // entries without a draft field count as non-drafts
    expect(result.count).toBe(2);
    const titles = result.entries.map((e: { title?: string }) => e.title);
    expect(titles).toContain('Live');
    expect(titles).not.toContain('WIP');
  });

  it('creates an entry when no data is supplied', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'create_entry',
        arguments: { collection: 'blog', slug: 'no-data', body: 'Just a body' },
      },
    });
    expect(res.error).toBeUndefined();
    const read = await server.handleRequest({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'get_entry', arguments: { collection: 'blog', slug: 'no-data' } },
    });
    const result = JSON.parse((read.result as any).content[0].text);
    expect(result.body).toContain('Just a body');
  });

  it('search matches body text for entries without a title', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: { name: 'search_entries', arguments: { collection: 'blog', query: 'needle-token' } },
    });
    const result = JSON.parse((res.result as any).content[0].text);
    expect(result.count).toBe(1);
    expect(result.entries[0].slug).toBe('untitled');
  });

  it('list_tags skips entries without tags', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: { name: 'list_tags', arguments: { collection: 'blog' } },
    });
    const result = JSON.parse((res.result as any).content[0].text);
    expect(result.tags).toEqual([]);
  });

  it('tools/call defaults to empty arguments', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_collections' },
    });
    const result = JSON.parse((res.result as any).content[0].text);
    expect(result.collections).toEqual(['blog']);
  });

  it('rejects an invalid resource URI', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: 'not-a-content-uri' },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32602);
  });

  it('rejects reading a resource for an unknown collection', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'content://nope' },
    });
    expect(res.error).toBeDefined();
  });

  it('errors when reading a missing entry resource', async () => {
    const server = createServer();
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/read',
      params: { uri: 'content://blog/ghost' },
    });
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain('not found');
  });
});
