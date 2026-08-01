// unit tests for the seo generators: sitemap, robots, og-image, meta tags,
// json-ld, asset extraction, and amp branches.

import { describe, expect, it, vi } from 'vitest';

import { generateAmpPage } from './seo/amp';
import { generateJsonLd, generateMetaTags } from './seo/meta';
import { generateOgSvg, svgToPng } from './seo/og-image';
import { extractAssetTags, generatePrerenderedPage } from './seo/prerender';
import { generateRobots } from './seo/robots';
import { generateSitemap } from './seo/sitemap';
import type { SeoConfig, SeoEntry } from './seo/types';

const config: SeoConfig = {
  siteUrl: 'https://example.test',
  siteTitle: 'My Site',
  siteDescription: 'A site',
};

const entry: SeoEntry = {
  slug: 'first-post',
  title: 'First Post',
  description: 'The first post',
  date: '2026-01-15T12:00:00Z',
  tags: ['alpha', 'beta'],
  html: '<p>Hello</p>',
};

// ---------------------------------------------------------------------------
// sitemap
// ---------------------------------------------------------------------------

describe('generateSitemap', () => {
  it('lists the home page first, then each entry with lastmod', () => {
    const xml = generateSitemap([entry], config);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const home = xml.indexOf('<loc>https://example.test/</loc>');
    const post = xml.indexOf('<loc>https://example.test/blog/first-post</loc>');
    expect(home).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(home);
    expect(xml).toContain('<lastmod>2026-01-15</lastmod>');
    expect(xml).toContain('<priority>1.0</priority>');
    expect(xml).toContain('<priority>0.8</priority>');
  });

  it('uses a custom routePrefix', () => {
    const xml = generateSitemap([entry], { ...config, routePrefix: 'articles' });
    expect(xml).toContain('<loc>https://example.test/articles/first-post</loc>');
  });

  it('escapes XML special characters in URLs', () => {
    const xml = generateSitemap([{ ...entry, slug: 'a-b' }], {
      ...config,
      siteUrl: 'https://example.test/?q=a&b',
    });
    expect(xml).toContain('https://example.test/?q=a&amp;b');
    expect(xml).not.toContain('q=a&b/');
  });

  it('produces only the home page for an empty entry list', () => {
    const xml = generateSitemap([], config);
    expect(xml).toContain('<loc>https://example.test/</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// robots
// ---------------------------------------------------------------------------

describe('generateRobots', () => {
  it('allows everything and points at the sitemap', () => {
    const robots = generateRobots(config);
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://example.test/sitemap.xml');
  });
});

// ---------------------------------------------------------------------------
// og-image
// ---------------------------------------------------------------------------

describe('generateOgSvg', () => {
  it('defaults to the dark variant (white glyph on black)', () => {
    const svg = generateOgSvg();
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('translate(490,165)');
  });

  it('supports the light variant', () => {
    const svg = generateOgSvg(undefined, { variant: 'light' });
    expect(svg).toContain('<rect width="1200" height="630" fill="#ffffff"/>');
    expect(svg).toContain('fill="#000000"/>');
  });
});

describe('svgToPng', () => {
  it('returns null when no sharp instance is provided', async () => {
    expect(await svgToPng('<svg/>')).toBeNull();
  });

  it('pipes the svg through the provided sharp instance', async () => {
    const toBuffer = vi.fn().mockResolvedValue(Buffer.from('png-bytes'));
    const png = vi.fn(() => ({ toBuffer }));
    const resize = vi.fn(() => ({ png }));
    const sharpFn = vi.fn(() => ({ resize }));

    const result = await svgToPng('<svg/>', sharpFn);
    expect(result).toEqual(Buffer.from('png-bytes'));
    expect(sharpFn).toHaveBeenCalledWith(Buffer.from('<svg/>'));
    expect(resize).toHaveBeenCalledWith(1200, 630);
  });

  it('returns null when sharp throws', async () => {
    const sharpFn = () => {
      throw new Error('sharp exploded');
    };
    expect(await svgToPng('<svg/>', sharpFn)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// meta tags
// ---------------------------------------------------------------------------

describe('generateMetaTags', () => {
  it('emits title, canonical, og, twitter and article tags', () => {
    const tags = generateMetaTags(entry, config);
    expect(tags).toContain('<title>First Post — My Site</title>');
    expect(tags).toContain('<meta name="description" content="The first post">');
    expect(tags).toContain('<link rel="canonical" href="https://example.test/blog/first-post">');
    expect(tags).toContain('<link rel="amphtml" href="https://example.test/amp/blog/first-post">');
    expect(tags).toContain(
      '<meta property="og:image" content="https://example.test/og/first-post.png">',
    );
    expect(tags).toContain('<meta property="og:locale" content="en_GB">');
    expect(tags).toContain('<meta property="article:tag" content="alpha">');
    expect(tags).toContain('<meta property="article:tag" content="beta">');
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(tags).toContain(
      '<meta property="article:published_time" content="2026-01-15T12:00:00.000Z">',
    );
  });

  it('includes the author tag when configured', () => {
    const tags = generateMetaTags(entry, { ...config, author: { name: 'Alice' } });
    expect(tags).toContain('<meta property="article:author" content="Alice">');
  });

  it('omits author and tag metas when not provided', () => {
    const tags = generateMetaTags({ ...entry, tags: undefined }, config);
    expect(tags).not.toContain('article:author');
    expect(tags).not.toContain('article:tag');
  });

  it('falls back to an empty description and escapes HTML in the title', () => {
    const tags = generateMetaTags(
      { ...entry, description: undefined, title: 'A "quoted" <title>' },
      config,
    );
    expect(tags).toContain('<meta name="description" content="">');
    expect(tags).toContain('A &quot;quoted&quot; &lt;title&gt;');
  });

  it('uses a custom locale and route prefix', () => {
    const tags = generateMetaTags(entry, { ...config, locale: 'en_US', routePrefix: 'posts' });
    expect(tags).toContain('<meta property="og:locale" content="en_US">');
    expect(tags).toContain('https://example.test/posts/first-post');
  });
});

describe('generateJsonLd', () => {
  it('emits BlogPosting structured data with keywords and description', () => {
    const out = generateJsonLd(entry, config);
    const json = JSON.parse(
      out.replace('<script type="application/ld+json">', '').replace('</script>', ''),
    );
    expect(json['@type']).toBe('BlogPosting');
    expect(json.headline).toBe('First Post');
    expect(json.description).toBe('The first post');
    expect(json.keywords).toBe('alpha, beta');
    expect(json.url).toBe('https://example.test/blog/first-post');
    expect(json.image).toBe('https://example.test/og/first-post.png');
    expect(json.publisher).toEqual({ '@type': 'Person', name: 'My Site' });
  });

  it('includes author with and without url', () => {
    const withUrl = generateJsonLd(entry, {
      ...config,
      author: { name: 'Alice', url: 'https://alice.test' },
    });
    expect(withUrl).toContain(
      '"author":{"@type":"Person","name":"Alice","url":"https://alice.test"}',
    );
    expect(withUrl).toContain('"publisher":{"@type":"Person","name":"Alice"}');

    const noUrl = generateJsonLd(entry, { ...config, author: { name: 'Bob' } });
    expect(noUrl).toContain('"author":{"@type":"Person","name":"Bob"}');
  });

  it('omits description and keywords when absent', () => {
    const out = generateJsonLd({ ...entry, description: undefined, tags: undefined }, config);
    expect(out).not.toContain('"description"');
    expect(out).not.toContain('"keywords"');
  });
});

// ---------------------------------------------------------------------------
// prerender asset extraction
// ---------------------------------------------------------------------------

describe('extractAssetTags', () => {
  it('extracts module scripts and stylesheets', () => {
    const html =
      '<head><script type="module" crossorigin src="/assets/a.js"></script>' +
      '<link rel="stylesheet" crossorigin href="/assets/a.css">' +
      '<script src="/legacy.js"></script>' +
      '<link rel="icon" href="/favicon.svg"></head>';
    const assets = extractAssetTags(html);
    expect(assets.scripts).toContain('/assets/a.js');
    expect(assets.scripts).not.toContain('/legacy.js');
    expect(assets.styles).toContain('/assets/a.css');
    expect(assets.styles).not.toContain('favicon');
  });

  it('returns empty strings when nothing matches', () => {
    const assets = extractAssetTags('<head></head>');
    expect(assets).toEqual({ scripts: '', styles: '' });
  });
});

describe('generatePrerenderedPage — attribute sanitisation', () => {
  it('removes attributes outside the safe list while keeping the element', () => {
    const page = generatePrerenderedPage(
      { ...entry, html: '<p style="color:red" data-x="1" class="ok">text</p>' },
      config,
      { scripts: '', styles: '' },
    );
    expect(page).toContain('<p class="ok">text</p>');
    expect(page).not.toContain('style="color:red"');
    expect(page).not.toContain('data-x');
  });
});

describe('generatePrerenderedPage — assets embedding', () => {
  it('renders an empty prose section when the entry has no html', () => {
    const page = generatePrerenderedPage({ ...entry, html: undefined }, config, {
      scripts: '',
      styles: '',
    });
    expect(page).toContain('<div class="prose">');
    expect(page).toContain('<h1>First Post</h1>');
  });

  it('injects extracted scripts and styles into the page', () => {
    const page = generatePrerenderedPage(entry, config, {
      scripts: '<script type="module" src="/assets/a.js"></script>',
      styles: '<link rel="stylesheet" href="/assets/a.css">',
    });
    expect(page).toContain('/assets/a.js');
    expect(page).toContain('/assets/a.css');
    expect(page).toContain('<h1>First Post</h1>');
  });
});

// ---------------------------------------------------------------------------
// amp branches
// ---------------------------------------------------------------------------

describe('generateAmpPage — branches', () => {
  it('renders tags and strips the canonical/amphtml links from shared meta', () => {
    const out = generateAmpPage(entry, config);
    expect(out).toContain('<div class="tags"><span>alpha</span><span>beta</span></div>');
    // exactly one canonical link (the AMP page's own)
    expect(out.match(/rel="canonical"/g)).toHaveLength(1);
    expect(out).not.toContain('rel="amphtml"');
    expect(out).toContain('<style amp-boilerplate>');
  });

  it('omits the tags block when the entry has no tags', () => {
    const out = generateAmpPage({ ...entry, tags: undefined }, config);
    expect(out).not.toContain('class="tags"');
  });

  it('handles an entry without html', () => {
    const out = generateAmpPage({ ...entry, html: undefined }, config);
    expect(out).toContain('<div class="prose">');
  });

  it('fills in default width/height for images without dimensions', () => {
    const out = generateAmpPage({ ...entry, html: '<img src="/a.png" alt="a">' }, config);
    expect(out).toContain(
      '<amp-img src="/a.png" alt="a" width="800" height="450" layout="responsive"></amp-img>',
    );
  });

  it('converts an image without a src to an empty-src amp-img', () => {
    const out = generateAmpPage({ ...entry, html: '<img alt="orphan">' }, config);
    expect(out).toContain('<amp-img src="" alt="orphan"');
  });

  it('preserves explicit width/height on images', () => {
    const out = generateAmpPage(
      { ...entry, html: '<img src="/a.png" alt="a" width="640" height="480">' },
      config,
    );
    expect(out).toContain('width="640" height="480"');
  });
});
