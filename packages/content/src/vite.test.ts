// unit tests for the vite plugin — hooks are invoked directly as functions
// with mock contexts, no real vite server involved.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import contentPlugin from './vite';
import type { Plugin } from 'vite';

const SCRATCH = '/tmp/claude-0/-home-user-utopiajs/4e9c47cd-38d7-56cd-a2c6-8bddac297eab/scratchpad';

const VIRTUAL_ID = 'virtual:utopia-content';
const RESOLVED_ID = '\0virtual:utopia-content';

function hook<T>(plugin: Plugin, name: keyof Plugin): T {
  const h = plugin[name] as any;
  return (typeof h === 'object' && h !== null && 'handler' in h ? h.handler : h) as T;
}

function configure(plugin: Plugin, root: string, outDir = 'dist'): void {
  hook<(config: unknown) => void>(plugin, 'configResolved')({ root, build: { outDir } });
}

async function loadManifest(plugin: Plugin): Promise<Record<string, any[]>> {
  const code = (await hook<(id: string) => Promise<string | undefined>>(
    plugin,
    'load',
  )(RESOLVED_ID)) as string;
  // code is `export const collections = {...};`
  const json = code.replace('export const collections = ', '').replace(/;$/, '');
  return JSON.parse(json);
}

describe('vite plugin — resolveId / load', () => {
  let root: string;

  beforeEach(async () => {
    await mkdir(SCRATCH, { recursive: true });
    root = await mkdtemp(join(SCRATCH, 'vite-load-'));
    const blog = join(root, 'content', 'blog');
    await mkdir(blog, { recursive: true });
    await writeFile(
      join(blog, 'first.md'),
      '---\ntitle: First\ndate: 2026-01-01\n---\n\n# Heading\n\nBody text.',
    );
    await writeFile(join(blog, 'data.json'), '{"title": "Json Entry"}');
    await writeFile(join(blog, 'broken.json'), '{not json');
    await writeFile(join(blog, 'conf.yaml'), 'title: Yaml Entry');
    await writeFile(join(blog, 'conf2.yml'), 'title: Yml Entry');
    await writeFile(join(blog, 'notes.txt'), 'not content');
    await writeFile(
      join(blog, 'comp.utopia'),
      '<script>export const metadata = {"x": 1};</script><template><div/></template>',
    );
    // a plain file at the content root (not a collection dir) must be skipped
    await writeFile(join(root, 'content', 'stray.md'), '---\ntitle: Stray\n---\nStray');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolveId maps the virtual module id and ignores others', () => {
    const plugin = contentPlugin();
    const resolveId = hook<(id: string) => string | undefined>(plugin, 'resolveId');
    expect(resolveId(VIRTUAL_ID)).toBe(RESOLVED_ID);
    expect(resolveId('some-other-module')).toBeUndefined();
  });

  it('load ignores non-virtual ids', async () => {
    const plugin = contentPlugin();
    configure(plugin, root);
    const load = hook<(id: string) => Promise<unknown>>(plugin, 'load');
    expect(await load('/src/main.ts')).toBeUndefined();
  });

  it('load generates a manifest with frontmatter data only by default', async () => {
    const plugin = contentPlugin();
    configure(plugin, root);
    const collections = await loadManifest(plugin);

    expect(Object.keys(collections)).toEqual(['blog']);
    const slugs = collections.blog.map((e) => e.slug).sort();
    // broken.json is skipped (invalid), notes.txt is not a content extension,
    // and .utopia files are listed with empty data (no manifest extraction)
    expect(slugs).toEqual(['broken', 'comp', 'conf', 'conf2', 'data', 'first']);
    expect(collections.blog.find((e) => e.slug === 'comp').data).toEqual({});

    const first = collections.blog.find((e) => e.slug === 'first');
    expect(first.data.title).toBe('First');
    expect(first.body).toBeUndefined();
    expect(first.html).toBeUndefined();

    const broken = collections.blog.find((e) => e.slug === 'broken');
    expect(broken.data).toEqual({});

    expect(collections.blog.find((e) => e.slug === 'conf').data.title).toBe('Yaml Entry');
    expect(collections.blog.find((e) => e.slug === 'conf2').data.title).toBe('Yml Entry');
  });

  it('load embeds body and html when requested', async () => {
    const plugin = contentPlugin({ embedBody: true, embedHtml: true });
    configure(plugin, root);
    const collections = await loadManifest(plugin);

    const first = collections.blog.find((e) => e.slug === 'first');
    expect(first.body).toContain('# Heading');
    expect(first.html).toContain('<h1 id="heading">Heading</h1>');
  });

  it('load embeds html without body when only embedHtml is set', async () => {
    const plugin = contentPlugin({ embedHtml: true, markdown: { highlight: false } });
    configure(plugin, root);
    const collections = await loadManifest(plugin);

    const first = collections.blog.find((e) => e.slug === 'first');
    expect(first.html).toContain('<h1 id="heading">Heading</h1>');
    expect(first.body).toBeUndefined();
  });

  it('load returns an empty manifest for a missing content dir', async () => {
    const plugin = contentPlugin({ contentDir: 'no-such-dir' });
    configure(plugin, root);
    const collections = await loadManifest(plugin);
    expect(collections).toEqual({});
  });
});

describe('vite plugin — configureServer', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(SCRATCH, 'vite-server-'));
    await mkdir(join(root, 'content', 'blog'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function mockServer() {
    const handlers: Record<string, (event: string, path: string) => void> = {};
    const mod = { id: RESOLVED_ID };
    const server = {
      watcher: {
        add: vi.fn(),
        on: vi.fn((event: string, cb: (event: string, path: string) => void) => {
          handlers[event] = cb;
        }),
      },
      moduleGraph: {
        getModuleById: vi.fn(() => mod),
        invalidateModule: vi.fn(),
      },
      ws: { send: vi.fn() },
    };
    return { server, handlers, mod };
  }

  it('watches the content dir and reloads on content file changes', () => {
    const plugin = contentPlugin();
    configure(plugin, root);
    const { server, handlers, mod } = mockServer();
    hook<(server: unknown) => void>(plugin, 'configureServer')(server);

    expect(server.watcher.add).toHaveBeenCalledWith(join(root, 'content'));

    handlers['all']('change', join(root, 'content', 'blog', 'post.md'));
    expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(mod);
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });
  });

  it('ignores changes outside the content dir and non-content extensions', () => {
    const plugin = contentPlugin();
    configure(plugin, root);
    const { server, handlers } = mockServer();
    hook<(server: unknown) => void>(plugin, 'configureServer')(server);

    handlers['all']('change', join(root, 'src', 'main.ts'));
    handlers['all']('change', join(root, 'content', 'blog', 'image.png'));
    expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
    expect(server.ws.send).not.toHaveBeenCalled();
  });

  it('does not reload when the virtual module was never loaded', () => {
    const plugin = contentPlugin();
    configure(plugin, root);
    const { server, handlers } = mockServer();
    server.moduleGraph.getModuleById = vi.fn(() => null) as any;
    hook<(server: unknown) => void>(plugin, 'configureServer')(server);

    handlers['all']('change', join(root, 'content', 'blog', 'post.md'));
    expect(server.ws.send).not.toHaveBeenCalled();
  });

  it('does not watch a missing content dir', () => {
    const plugin = contentPlugin({ contentDir: 'nope' });
    configure(plugin, root);
    const { server } = mockServer();
    hook<(server: unknown) => void>(plugin, 'configureServer')(server);
    expect(server.watcher.add).not.toHaveBeenCalled();
  });
});

describe('vite plugin — generateBundle (feeds)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(SCRATCH, 'vite-feed-'));
    const blog = join(root, 'content', 'blog');
    await mkdir(blog, { recursive: true });
    await writeFile(
      join(blog, 'newer.md'),
      '---\ntitle: Newer Post\ndate: 2026-02-01\n---\nNewer body',
    );
    await writeFile(
      join(blog, 'older.md'),
      '---\ntitle: Older Post\ndate: 2026-01-01\ntags:\n  - tag-a\n---\nOlder body',
    );
    await writeFile(
      join(blog, 'draft.md'),
      '---\ntitle: Draft Post\ndate: 2026-03-01\ndraft: true\n---\nDraft body',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const feed = {
    title: 'My Blog',
    description: 'Posts',
    siteUrl: 'https://example.test',
  };

  async function runGenerateBundle(plugin: Plugin) {
    // load populates collectedEntries
    await hook<(id: string) => Promise<unknown>>(plugin, 'load')(RESOLVED_ID);
    const emitFile = vi.fn();
    hook<() => void>(plugin, 'generateBundle').call({ emitFile });
    return emitFile;
  }

  it('emits RSS and Atom feeds excluding drafts, newest first', async () => {
    const plugin = contentPlugin({ feed });
    configure(plugin, root);
    const emitFile = await runGenerateBundle(plugin);

    expect(emitFile).toHaveBeenCalledTimes(2);
    const calls = emitFile.mock.calls.map((c) => c[0]);
    const rss = calls.find((c) => c.fileName === 'feed.xml');
    const atom = calls.find((c) => c.fileName === 'atom.xml');

    expect(rss.source).toContain('<title>My Blog</title>');
    expect(rss.source).toContain('<title>Newer Post</title>');
    expect(rss.source).toContain('<category>tag-a</category>');
    expect(rss.source).not.toContain('Draft Post');
    expect(rss.source.indexOf('Newer Post')).toBeLessThan(rss.source.indexOf('Older Post'));
    expect(rss.source).toContain('https://example.test/blog/newer');
    expect(rss.source).toContain('atom:link href="https://example.test/feed.xml" rel="self"');

    expect(atom.source).toContain('<title>Newer Post</title>');
    expect(atom.source).toContain('href="https://example.test/atom.xml" rel="self"');
  });

  it('includes drafts when filterDrafts is false', async () => {
    const plugin = contentPlugin({ feed: { ...feed, filterDrafts: false } });
    configure(plugin, root);
    const emitFile = await runGenerateBundle(plugin);
    const rss = emitFile.mock.calls.map((c) => c[0]).find((c) => c.fileName === 'feed.xml');
    expect(rss.source).toContain('Draft Post');
  });

  it('falls back to slug and current date for entries missing title/date', async () => {
    const bareRoot = await mkdtemp(join(SCRATCH, 'vite-bare-'));
    const blog = join(bareRoot, 'content', 'blog');
    await mkdir(blog, { recursive: true });
    await writeFile(join(blog, 'no-meta.md'), 'Just a body with no frontmatter');

    const plugin = contentPlugin({ feed });
    configure(plugin, bareRoot);
    const emitFile = await runGenerateBundle(plugin);
    const rss = emitFile.mock.calls.map((c) => c[0]).find((c) => c.fileName === 'feed.xml');
    expect(rss.source).toContain('<title>no-meta</title>');
    expect(rss.source).toContain('<pubDate>');

    await rm(bareRoot, { recursive: true, force: true });
  });

  it('does nothing without a feed option', async () => {
    const plugin = contentPlugin();
    configure(plugin, root);
    const emitFile = await runGenerateBundle(plugin);
    expect(emitFile).not.toHaveBeenCalled();
  });

  it('does nothing when the named collection has no entries', async () => {
    const plugin = contentPlugin({ feed: { ...feed, collection: 'missing' } });
    configure(plugin, root);
    const emitFile = await runGenerateBundle(plugin);
    expect(emitFile).not.toHaveBeenCalled();
  });
});

describe('vite plugin — writeBundle (SEO assets)', () => {
  let root: string;
  let outDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(SCRATCH, 'vite-seo-'));
    outDir = join(root, 'dist');
    const blog = join(root, 'content', 'blog');
    await mkdir(blog, { recursive: true });
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(blog, 'post.md'),
      '---\ntitle: SEO Post\ndate: 2026-01-05\ndescription: A post\ntags:\n  - seo\n---\n\n# SEO Post\n\nContent with ![pic](/pic.png)',
    );
    await writeFile(
      join(blog, 'draft.md'),
      '---\ntitle: Secret Draft\ndate: 2026-01-06\ndraft: true\n---\nHidden',
    );
    await writeFile(
      join(outDir, 'index.html'),
      '<!doctype html><html><head>' +
        '<script type="module" src="/assets/index-abc.js"></script>' +
        '<link rel="stylesheet" href="/assets/index-abc.css">' +
        '</head><body></body></html>',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const feed = { title: 'Site', description: 'Desc', siteUrl: 'https://example.test' };

  async function runWriteBundle(plugin: Plugin) {
    await hook<(id: string) => Promise<unknown>>(plugin, 'load')(RESOLVED_ID);
    await hook<() => Promise<void>>(plugin, 'writeBundle')();
  }

  it('writes prerendered pages, AMP pages, OG images, sitemap and robots.txt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = contentPlugin({ embedHtml: true, feed, seo: {} });
    configure(plugin, root);
    await runWriteBundle(plugin);

    const prerendered = await readFile(join(outDir, 'blog', 'post', 'index.html'), 'utf-8');
    expect(prerendered).toContain('<title>SEO Post — Site</title>');
    expect(prerendered).toContain('/assets/index-abc.js');
    expect(prerendered).toContain('/assets/index-abc.css');
    expect(prerendered).toContain('<h1>SEO Post</h1>');

    const amp = await readFile(join(outDir, 'amp', 'blog', 'post', 'index.html'), 'utf-8');
    expect(amp).toContain('<html amp');
    expect(amp).toContain('<amp-img');

    // OG image is a PNG when sharp is resolvable, otherwise an SVG fallback
    expect(
      existsSync(join(outDir, 'og', 'post.png')) || existsSync(join(outDir, 'og', 'post.svg')),
    ).toBe(true);

    const sitemap = await readFile(join(outDir, 'sitemap.xml'), 'utf-8');
    expect(sitemap).toContain('https://example.test/blog/post');
    expect(sitemap).not.toContain('draft');

    const robots = await readFile(join(outDir, 'robots.txt'), 'utf-8');
    expect(robots).toContain('Sitemap: https://example.test/sitemap.xml');

    // drafts must not be prerendered
    expect(existsSync(join(outDir, 'blog', 'draft'))).toBe(false);
  });

  it('skips SEO generation entirely when siteUrl is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = contentPlugin({ embedHtml: true, seo: {} });
    configure(plugin, root);
    await runWriteBundle(plugin);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('siteUrl is required'));
    expect(existsSync(join(outDir, 'sitemap.xml'))).toBe(false);
  });

  it('honours amp/sitemap/robots/ogImage opt-outs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const plugin = contentPlugin({
      embedHtml: true,
      feed,
      seo: { amp: false, sitemap: false, robots: false, ogImage: false },
    });
    configure(plugin, root);
    await runWriteBundle(plugin);

    expect(existsSync(join(outDir, 'blog', 'post', 'index.html'))).toBe(true);
    expect(existsSync(join(outDir, 'amp'))).toBe(false);
    expect(existsSync(join(outDir, 'og'))).toBe(false);
    expect(existsSync(join(outDir, 'sitemap.xml'))).toBe(false);
    expect(existsSync(join(outDir, 'robots.txt'))).toBe(false);
  });

  it('does nothing without a seo option', async () => {
    const plugin = contentPlugin({ embedHtml: true, feed });
    configure(plugin, root);
    await runWriteBundle(plugin);
    expect(existsSync(join(outDir, 'sitemap.xml'))).toBe(false);
  });

  it('does nothing when the seo collection has no entries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = contentPlugin({ embedHtml: true, feed, seo: { collection: 'missing' } });
    configure(plugin, root);
    await runWriteBundle(plugin);
    expect(existsSync(join(outDir, 'sitemap.xml'))).toBe(false);
  });

  it('works without a built index.html (no asset tags)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await rm(join(outDir, 'index.html'));
    const plugin = contentPlugin({ embedHtml: true, feed, seo: { ogImage: false } });
    configure(plugin, root);
    await runWriteBundle(plugin);

    const prerendered = await readFile(join(outDir, 'blog', 'post', 'index.html'), 'utf-8');
    expect(prerendered).not.toContain('index-abc.js');
    expect(prerendered).toContain('<title>SEO Post — Site</title>');
  });

  it('falls back to an SVG OG image when sharp fails at conversion time', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // plant a stub sharp in the project root that throws when invoked, so the
    // require succeeds but svgToPng returns null
    const stubDir = join(root, 'node_modules', 'sharp');
    await mkdir(stubDir, { recursive: true });
    await writeFile(join(stubDir, 'package.json'), '{"name":"sharp","main":"index.js"}');
    await writeFile(
      join(stubDir, 'index.js'),
      'module.exports = () => { throw new Error("no sharp"); };',
    );
    await writeFile(join(root, 'package.json'), '{"name":"tmp-root"}');

    const plugin = contentPlugin({ embedHtml: true, feed, seo: {} });
    configure(plugin, root);
    await runWriteBundle(plugin);

    expect(existsSync(join(outDir, 'og', 'post.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'og', 'post.png'))).toBe(false);
    const svg = await readFile(join(outDir, 'og', 'post.svg'), 'utf-8');
    expect(svg).toContain('<svg');
  });

  it('honours an ogImage config object (light variant)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // sharp stub that throws forces the SVG path so the variant is inspectable
    const stubDir = join(root, 'node_modules', 'sharp');
    await mkdir(stubDir, { recursive: true });
    await writeFile(join(stubDir, 'package.json'), '{"name":"sharp","main":"index.js"}');
    await writeFile(
      join(stubDir, 'index.js'),
      'module.exports = () => { throw new Error("no"); };',
    );
    await writeFile(join(root, 'package.json'), '{"name":"tmp-root"}');

    const plugin = contentPlugin({
      embedHtml: true,
      feed,
      seo: { ogImage: { variant: 'light' } },
    });
    configure(plugin, root);
    await runWriteBundle(plugin);

    const svg = await readFile(join(outDir, 'og', 'post.svg'), 'utf-8');
    expect(svg).toContain('<rect width="1200" height="630" fill="#ffffff"/>');
  });

  it('warns and uses SVG OG images when sharp cannot be required', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // a stub whose module body throws makes require('sharp') fail outright
    const stubDir = join(root, 'node_modules', 'sharp');
    await mkdir(stubDir, { recursive: true });
    await writeFile(join(stubDir, 'package.json'), '{"name":"sharp","main":"index.js"}');
    await writeFile(join(stubDir, 'index.js'), 'throw new Error("install failed");');
    await writeFile(join(root, 'package.json'), '{"name":"tmp-root"}');

    const plugin = contentPlugin({ embedHtml: true, feed, seo: {} });
    configure(plugin, root);
    await runWriteBundle(plugin);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sharp not found'));
    expect(existsSync(join(outDir, 'og', 'post.svg'))).toBe(true);
  });

  it('skips OG image generation for entries with an explicit image', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(
      join(root, 'content', 'blog', 'with-image.md'),
      '---\ntitle: Has Image\ndate: 2026-01-07\nimage: covers/custom.png\n---\nBody',
    );
    const plugin = contentPlugin({ embedHtml: true, feed, seo: {} });
    configure(plugin, root);
    await runWriteBundle(plugin);

    expect(existsSync(join(outDir, 'og', 'with-image.svg'))).toBe(false);
    expect(existsSync(join(outDir, 'og', 'with-image.png'))).toBe(false);
    expect(
      existsSync(join(outDir, 'og', 'post.png')) || existsSync(join(outDir, 'og', 'post.svg')),
    ).toBe(true);
  });
});
