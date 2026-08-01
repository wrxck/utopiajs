// regression tests for bugs found in the code-quality review pass.
// each describe block names the bug it pins down.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createFilesystemAdapter } from './adapters/filesystem';
import {
  createContent,
  defineCollection,
  getCollection,
  clearCollections,
  getCollectionAdapter,
} from './collection';
import * as contentIndex from './index';
import { generateAmpPage } from './seo/amp';
import { generateJsonLd } from './seo/meta';
import contentPlugin from './vite';
import type { SeoConfig, SeoEntry } from './seo/types';

// ---------------------------------------------------------------------------
// BUG 1 — filesystem adapter: .yml files are discovered by readEntries and
// listSlugs, but readEntry/updateEntry only ever look for the .yaml spelling,
// so a .yml entry cannot be read by slug and updateEntry would write a
// duplicate .yaml file next to the original .yml.
// ---------------------------------------------------------------------------

describe('filesystem adapter — .yml extension parity', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-yml-'));
    await mkdir(join(tmpDir, 'data'), { recursive: true });
    await writeFile(join(tmpDir, 'data', 'config.yml'), 'title: From Yml\nport: 8080\n');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const config = { name: 'data', directory: 'data' };

  it('readEntry finds an entry stored as .yml', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    const entry = await adapter.readEntry(config, 'config');
    expect(entry).not.toBeNull();
    expect(entry!.format).toBe('yaml');
    expect(entry!.data.title).toBe('From Yml');
  });

  it('updateEntry updates the .yml file in place instead of writing a .yaml duplicate', async () => {
    const adapter = createFilesystemAdapter(tmpDir);
    await adapter.updateEntry(config, 'config', { title: 'Updated' });

    expect(existsSync(join(tmpDir, 'data', 'config.yml'))).toBe(true);
    expect(existsSync(join(tmpDir, 'data', 'config.yaml'))).toBe(false);

    const entry = await adapter.readEntry(config, 'config');
    expect(entry!.data.title).toBe('Updated');
    expect(entry!.data.port).toBe(8080);

    const entries = await adapter.readEntries(config);
    expect(entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// BUG 2 — filesystem adapter: readEntry refuses to follow a symlink that
// escapes the content root, but readEntries followed the same symlink happily.
// ---------------------------------------------------------------------------

describe('filesystem adapter — readEntries symlink escape', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-symlink-'));
    await mkdir(join(tmpDir, 'content'), { recursive: true });
    await writeFile(join(tmpDir, 'secret.md'), '---\ntitle: secret\n---\ntop secret');
    symlinkSync(join(tmpDir, 'secret.md'), join(tmpDir, 'content', 'leak.md'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects a symlinked file pointing outside the collection directory', async () => {
    const adapter = createFilesystemAdapter();
    const cfg = { name: 'blog', directory: join(tmpDir, 'content') };
    await expect(adapter.readEntries(cfg)).rejects.toThrow(/traversal/i);
  });
});

// ---------------------------------------------------------------------------
// BUG 3 — collection engine: limit: 0 was treated as "no limit" because of a
// falsy check, returning every entry instead of none.
// ---------------------------------------------------------------------------

describe('collection engine — limit: 0', () => {
  let tmpDir: string;

  beforeEach(async () => {
    clearCollections();
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-limit-'));
    await mkdir(join(tmpDir, 'blog'), { recursive: true });
    await writeFile(join(tmpDir, 'blog', 'one.md'), '---\ntitle: One\n---\nBody');
    await writeFile(join(tmpDir, 'blog', 'two.md'), '---\ntitle: Two\n---\nBody');
  });

  afterEach(async () => {
    clearCollections();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns no entries when limit is 0', async () => {
    createContent({ contentDir: tmpDir });
    defineCollection({ name: 'blog', directory: 'blog' });
    const entries = await getCollection('blog', { limit: 0 });
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BUG 4 — AMP convertImages: a ">" inside an attribute value (legal HTML,
// left unescaped by the jsdom sanitiser) truncated the <img ...> match,
// producing a broken <amp-img> and leaking the tag remainder as visible text.
// ---------------------------------------------------------------------------

describe('AMP convertImages — ">" inside attribute values', () => {
  const config: SeoConfig = {
    siteUrl: 'https://example.test',
    siteTitle: 'Example',
    siteDescription: 'desc',
  };

  it('converts the whole tag instead of truncating at the ">" in alt', () => {
    const entry: SeoEntry = {
      slug: 'post',
      title: 'Post',
      date: '2026-01-01',
      html: '<img src="x.png" alt="a>b">',
    };
    const out = generateAmpPage(entry, config);
    expect(out).toContain('<amp-img src="x.png" alt="a>b"');
    // The remainder of the original tag must not leak as text
    expect(out).not.toContain('b" src=');
  });
});

// ---------------------------------------------------------------------------
// BUG 5 — vite plugin: the content-dir check used a raw string prefix, so a
// sibling directory like "content-drafts" was mistaken for the content dir.
// ---------------------------------------------------------------------------

describe('vite plugin — content dir boundary', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'utopia-vite-bound-'));
    await mkdir(join(tmpDir, 'content'), { recursive: true });
    await mkdir(join(tmpDir, 'content-drafts'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makePlugin() {
    const plugin = contentPlugin({ contentDir: 'content' });

    (plugin.configResolved as any)({
      root: tmpDir,
      build: { outDir: 'dist' },
    });
    return plugin;
  }

  it('handleHotUpdate claims files inside the content dir', () => {
    const plugin = makePlugin();

    const result = (plugin.handleHotUpdate as any)({
      file: join(tmpDir, 'content', 'post.md'),
    });
    expect(result).toEqual([]);
  });

  it('handleHotUpdate ignores files in a sibling dir sharing the prefix', () => {
    const plugin = makePlugin();

    const result = (plugin.handleHotUpdate as any)({
      file: join(tmpDir, 'content-drafts', 'post.md'),
    });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// BUG 6 — package root did not export getCollectionAdapter, but
// packages/cli/src/index.ts imports the root module and calls it.
// ---------------------------------------------------------------------------

describe('package root exports', () => {
  it('exposes getCollectionAdapter (required by @matthesketh/utopia-cli mcp command)', () => {
    expect(typeof contentIndex.getCollectionAdapter).toBe('function');
  });

  it('getCollectionAdapter returns registered collections and null otherwise', () => {
    clearCollections();
    createContent({ contentDir: '/tmp/nowhere' });
    defineCollection({ name: 'blog', directory: 'blog' });
    expect(getCollectionAdapter('blog')).not.toBeNull();
    expect(getCollectionAdapter('missing')).toBeNull();
    clearCollections();
  });
});

// ---------------------------------------------------------------------------
// BUG 7 — json-ld image URL: an absolute image URL was prefixed with the site
// URL ("https://site/https://cdn/..."), and a leading-slash path produced a
// double slash.
// ---------------------------------------------------------------------------

describe('generateJsonLd — image URL resolution', () => {
  const config: SeoConfig = {
    siteUrl: 'https://example.test',
    siteTitle: 'Example',
    siteDescription: 'desc',
  };

  it('keeps absolute image URLs as-is', () => {
    const entry: SeoEntry = {
      slug: 'post',
      title: 'Post',
      date: '2026-01-01',
      image: 'https://cdn.example.test/img.png',
    };
    const out = generateJsonLd(entry, config);
    expect(out).toContain('"image":"https://cdn.example.test/img.png"');
    expect(out).not.toContain('https://example.test/https://');
  });

  it('does not double the slash for root-relative image paths', () => {
    const entry: SeoEntry = {
      slug: 'post',
      title: 'Post',
      date: '2026-01-01',
      image: '/images/cover.png',
    };
    const out = generateJsonLd(entry, config);
    expect(out).toContain('"image":"https://example.test/images/cover.png"');
    expect(out).not.toContain('example.test//images');
  });

  it('resolves bare relative image paths against the site URL', () => {
    const entry: SeoEntry = {
      slug: 'post',
      title: 'Post',
      date: '2026-01-01',
      image: 'images/cover.png',
    };
    const out = generateJsonLd(entry, config);
    expect(out).toContain('"image":"https://example.test/images/cover.png"');
  });
});
