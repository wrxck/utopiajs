// regression tests for the v0.8 content hardening pass: seo xss (amp + json-ld),
// frontmatter prototype pollution, and filesystem traversal/symlink defences.

import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { generateAmpPage } from './seo/amp';
import { generateJsonLd } from './seo/meta';
import { parseFrontmatter } from './frontmatter';
import { createFilesystemAdapter, validateSlug } from './adapters/filesystem';
import type { SeoConfig, SeoEntry } from './seo/types';

const config: SeoConfig = {
  siteUrl: 'https://example.test',
  siteTitle: 'Example',
  siteDescription: 'desc',
};

function entry(html: string, title = 'Title'): SeoEntry {
  return { slug: 'post', title, date: '2026-01-01', html };
}

describe('AMP page sanitises untrusted entry.html', () => {
  it('strips onerror image handlers (regex stripScripts was bypassable)', () => {
    const out = generateAmpPage(entry('<img src=x onerror="alert(1)">'), config);
    expect(out).not.toContain('onerror');
  });

  it('strips <svg onload> vectors', () => {
    const out = generateAmpPage(entry('<svg onload="alert(1)"></svg>'), config);
    expect(out).not.toContain('onload');
  });

  it('removes <script> from the rendered article body', () => {
    const out = generateAmpPage(entry('<p>ok</p><script>alert(1)</script>'), config);
    // the only <script> permitted is the amp runtime loader in <head>.
    expect(out).not.toContain('alert(1)');
  });
});

describe('JSON-LD does not allow </script> breakout', () => {
  it('escapes < > & in attacker-influenced title/description', () => {
    const out = generateJsonLd(entry('', '</script><script>alert(1)</script>'), config);
    expect(out).not.toContain('<script>alert(1)');
    expect(out).toContain('\\u003c');
  });
});

describe('frontmatter strips prototype-pollution keys', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it('drops __proto__ keys and does not pollute Object.prototype', () => {
    const { data } = parseFrontmatter('---\n__proto__:\n  polluted: true\ntitle: ok\n---\nbody');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(data, '__proto__')).toBe(false);
    expect(data.title).toBe('ok');
  });
});

describe('filesystem adapter traversal + symlink defences', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it('validateSlug rejects traversal sequences', () => {
    expect(() => validateSlug('../etc/passwd')).toThrow();
    expect(() => validateSlug('/etc/passwd')).toThrow();
    expect(() => validateSlug('a/../../b')).toThrow();
    expect(() => validateSlug('ok-slug')).not.toThrow();
  });

  it('updateEntry/deleteEntry validate the slug at the adapter boundary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'utopia-fs-'));
    tmpDirs.push(root);
    const adapter = createFilesystemAdapter();
    const cfg = { name: 'blog', directory: join(root, 'content') };
    await expect(adapter.updateEntry!(cfg, '../evil', { x: 1 })).rejects.toThrow();
    await expect(adapter.deleteEntry!(cfg, '../evil')).rejects.toThrow();
  });

  it('refuses to read through a symlink that escapes the content root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'utopia-fs-'));
    tmpDirs.push(root);
    const contentDir = join(root, 'content');
    mkdirSync(contentDir);
    const secret = join(root, 'secret.md');
    writeFileSync(secret, '---\ntitle: secret\n---\ntop secret');
    symlinkSync(secret, join(contentDir, 'leak.md'));

    const adapter = createFilesystemAdapter();
    const cfg = { name: 'blog', directory: contentDir };
    await expect(adapter.readEntry(cfg, 'leak')).rejects.toThrow(/traversal/i);
  });
});
