import { signal } from '@matthesketh/utopia-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetHead,
  setHead,
  setHtmlDir,
  setHtmlLang,
  setLink,
  setMeta,
  setTitle,
  useHead,
} from '@/head';

beforeEach(() => {
  resetHead();
  document.head.innerHTML = '';
  document.title = '';
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

// ---------------------------------------------------------------------------
// setTitle
// ---------------------------------------------------------------------------

describe('setTitle', () => {
  it('sets the document title', () => {
    setTitle('Home');
    expect(document.title).toBe('Home');
  });

  it('applies a title template', () => {
    setTitle('About', '%s | My Site');
    expect(document.title).toBe('About | My Site');
  });

  it('uses raw title when no template given', () => {
    setTitle('Contact');
    expect(document.title).toBe('Contact');
  });
});

// ---------------------------------------------------------------------------
// setMeta
// ---------------------------------------------------------------------------

describe('setMeta', () => {
  it('creates a name/content meta tag', () => {
    setMeta({ name: 'description', content: 'Hello world' });
    const el = document.head.querySelector('meta[name="description"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('content')).toBe('Hello world');
  });

  it('creates an OpenGraph property meta tag', () => {
    setMeta({ property: 'og:title', content: 'My Page' });
    const el = document.head.querySelector('meta[property="og:title"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('content')).toBe('My Page');
  });

  it('creates an http-equiv meta tag', () => {
    setMeta({ httpEquiv: 'X-UA-Compatible', content: 'IE=edge' });
    const el = document.head.querySelector('meta[http-equiv="X-UA-Compatible"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('content')).toBe('IE=edge');
  });

  it('creates a charset meta tag', () => {
    setMeta({ charset: 'utf-8' });
    const el = document.head.querySelector('meta[charset]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('charset')).toBe('utf-8');
  });

  it('updates an existing meta tag by name', () => {
    setMeta({ name: 'description', content: 'First' });
    setMeta({ name: 'description', content: 'Second' });
    const els = document.head.querySelectorAll('meta[name="description"]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('content')).toBe('Second');
  });

  it('updates an existing meta tag by property', () => {
    setMeta({ property: 'og:title', content: 'First' });
    setMeta({ property: 'og:title', content: 'Second' });
    const els = document.head.querySelectorAll('meta[property="og:title"]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('content')).toBe('Second');
  });

  it('tags managed elements with data attribute', () => {
    setMeta({ name: 'robots', content: 'index' });
    const el = document.head.querySelector('meta[name="robots"]');
    expect(el!.hasAttribute('data-utopia-helmet')).toBe(true);
  });

  it('creates a meta tag with an explicitly empty content', () => {
    // Regression: the create path dropped content="" (truthiness check)
    // while the update path honored it (!== undefined) — inconsistent.
    setMeta({ name: 'description', content: '' });
    const el = document.head.querySelector('meta[name="description"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('content')).toBe('');
  });

  it('updates an existing charset meta tag', () => {
    setMeta({ charset: 'utf-8' });
    setMeta({ charset: 'iso-8859-1' });
    const els = document.head.querySelectorAll('meta[charset]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('charset')).toBe('iso-8859-1');
  });

  it('updates an existing http-equiv meta tag', () => {
    setMeta({ httpEquiv: 'refresh', content: '30' });
    setMeta({ httpEquiv: 'refresh', content: '60' });
    const els = document.head.querySelectorAll('meta[http-equiv="refresh"]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('content')).toBe('60');
  });

  it('adopts a pre-existing unmanaged meta tag and manages it thereafter', () => {
    const ssrMeta = document.createElement('meta');
    ssrMeta.setAttribute('name', 'description');
    ssrMeta.setAttribute('content', 'server-rendered');
    document.head.appendChild(ssrMeta);

    setMeta({ name: 'description', content: 'client-updated' });

    // The existing element was updated in place, not duplicated…
    const els = document.head.querySelectorAll('meta[name="description"]');
    expect(els.length).toBe(1);
    expect(els[0]).toBe(ssrMeta);
    expect(els[0].getAttribute('content')).toBe('client-updated');
    // …and is now managed, so resetHead removes it.
    expect(els[0].hasAttribute('data-utopia-helmet')).toBe(true);
    resetHead();
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
  });

  it('creates a new tag for a descriptor with no identity fields', () => {
    // A content-only descriptor has nothing to match against — it is created.
    setMeta({ content: 'standalone' });
    const el = document.head.querySelector('meta[content="standalone"]');
    expect(el).not.toBeNull();
    expect(el!.hasAttribute('data-utopia-helmet')).toBe(true);
  });

  it('creates a fresh element when the existing-tag lookup throws', () => {
    // Defensive path: a hostile selector engine error must not break setMeta.
    const spy = vi.spyOn(document.head, 'querySelector').mockImplementation(() => {
      throw new SyntaxError('bad selector');
    });
    expect(() => setMeta({ name: 'robots', content: 'noindex' })).not.toThrow();
    spy.mockRestore();
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
  });

  it('falls back to manual escaping when CSS.escape is unavailable', () => {
    vi.stubGlobal('CSS', undefined);
    try {
      // A quote in the identity would otherwise produce an invalid selector.
      expect(() => setMeta({ name: 'a"b', content: 'v1' })).not.toThrow();
      // A bracket still breaks the selector — querySelector throws, and the
      // catch path must recover by creating a new element.
      expect(() => setMeta({ name: 'a[b', content: 'v2' })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(document.head.querySelector('meta[content="v1"]')).not.toBeNull();
    expect(document.head.querySelector('meta[content="v2"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setLink
// ---------------------------------------------------------------------------

describe('setLink', () => {
  it('creates a link tag', () => {
    setLink({ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' });
    const el = document.head.querySelector('link[rel="icon"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('href')).toBe('/favicon.svg');
    expect(el!.getAttribute('type')).toBe('image/svg+xml');
  });

  it('creates a canonical link', () => {
    setLink({ rel: 'canonical', href: 'https://example.com/' });
    const el = document.head.querySelector('link[rel="canonical"]');
    expect(el!.getAttribute('href')).toBe('https://example.com/');
  });

  it('creates a link with sizes', () => {
    setLink({ rel: 'apple-touch-icon', href: '/icon-180.png', sizes: '180x180' });
    const el = document.head.querySelector('link[rel="apple-touch-icon"]');
    expect(el!.getAttribute('sizes')).toBe('180x180');
  });

  it('creates a link with color attribute', () => {
    setLink({ rel: 'mask-icon', href: '/mask.svg', color: '#000000' });
    const el = document.head.querySelector('link[rel="mask-icon"]');
    expect(el!.getAttribute('color')).toBe('#000000');
  });

  it('updates an existing link by rel and sizes', () => {
    setLink({ rel: 'icon', href: '/old.png', sizes: '32x32' });
    setLink({ rel: 'icon', href: '/new.png', sizes: '32x32' });
    const els = document.head.querySelectorAll('link[rel="icon"][sizes="32x32"]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('href')).toBe('/new.png');
  });

  it('tags managed elements with data attribute', () => {
    setLink({ rel: 'icon', href: '/test.svg' });
    const el = document.head.querySelector('link[rel="icon"]');
    expect(el!.hasAttribute('data-utopia-helmet')).toBe(true);
  });

  it('updates the canonical link in place instead of duplicating it', () => {
    // Regression: links without sizes/type were keyed by rel+href, so a
    // canonical URL change appended a second <link rel="canonical">.
    setLink({ rel: 'canonical', href: 'https://example.com/a' });
    setLink({ rel: 'canonical', href: 'https://example.com/b' });
    const els = document.head.querySelectorAll('link[rel="canonical"]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('href')).toBe('https://example.com/b');
  });

  it('updates the manifest link in place instead of duplicating it', () => {
    setLink({ rel: 'manifest', href: '/old.webmanifest' });
    setLink({ rel: 'manifest', href: '/new.webmanifest' });
    const els = document.head.querySelectorAll('link[rel="manifest"]');
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('href')).toBe('/new.webmanifest');
  });

  it('creates a link with all optional attributes', () => {
    setLink({
      rel: 'preload',
      href: '/font.woff2',
      as: 'font',
      type: 'font/woff2',
      crossorigin: 'anonymous',
      media: 'screen',
      title: 'Font',
      color: '#123456',
    });
    const el = document.head.querySelector('link[rel="preload"]')!;
    expect(el.getAttribute('as')).toBe('font');
    expect(el.getAttribute('type')).toBe('font/woff2');
    expect(el.getAttribute('crossorigin')).toBe('anonymous');
    expect(el.getAttribute('media')).toBe('screen');
    expect(el.getAttribute('title')).toBe('Font');
    expect(el.getAttribute('color')).toBe('#123456');
  });

  it('updates all optional attributes on an existing link (matched by rel+type)', () => {
    setLink({ rel: 'preload', href: '/a.woff2', type: 'font/woff2' });
    setLink({
      rel: 'preload',
      href: '/b.woff2',
      type: 'font/woff2',
      as: 'font',
      crossorigin: 'use-credentials',
      media: 'print',
      title: 'Updated',
      color: '#654321',
    });
    const els = document.head.querySelectorAll('link[rel="preload"]');
    expect(els.length).toBe(1);
    const el = els[0];
    expect(el.getAttribute('href')).toBe('/b.woff2');
    expect(el.getAttribute('as')).toBe('font');
    expect(el.getAttribute('crossorigin')).toBe('use-credentials');
    expect(el.getAttribute('media')).toBe('print');
    expect(el.getAttribute('title')).toBe('Updated');
    expect(el.getAttribute('color')).toBe('#654321');
  });

  it('adopts a pre-existing unmanaged link tag and manages it thereafter', () => {
    const ssrLink = document.createElement('link');
    ssrLink.setAttribute('rel', 'canonical');
    ssrLink.setAttribute('href', 'https://example.com/ssr');
    document.head.appendChild(ssrLink);

    setLink({ rel: 'canonical', href: 'https://example.com/client' });

    const els = document.head.querySelectorAll('link[rel="canonical"]');
    expect(els.length).toBe(1);
    expect(els[0]).toBe(ssrLink);
    expect(els[0].getAttribute('href')).toBe('https://example.com/client');
    expect(els[0].hasAttribute('data-utopia-helmet')).toBe(true);

    resetHead();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('recovers when the link selector cannot be built (CSS.escape unavailable)', () => {
    vi.stubGlobal('CSS', undefined);
    try {
      expect(() => setLink({ rel: 'a[b', href: '/x' })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(document.head.querySelector('link[href="/x"]')).not.toBeNull();
  });

  it('creates a fresh element when the existing-tag lookup throws', () => {
    const spy = vi.spyOn(document.head, 'querySelector').mockImplementation(() => {
      throw new SyntaxError('bad selector');
    });
    expect(() => setLink({ rel: 'icon', href: '/i.svg' })).not.toThrow();
    spy.mockRestore();
    expect(document.head.querySelector('link[rel="icon"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setHtmlLang / setHtmlDir
// ---------------------------------------------------------------------------

describe('setHtmlLang', () => {
  it('sets the lang attribute on <html>', () => {
    setHtmlLang('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('updates the lang attribute', () => {
    setHtmlLang('en');
    setHtmlLang('fr');
    expect(document.documentElement.getAttribute('lang')).toBe('fr');
  });
});

describe('setHtmlDir', () => {
  it('sets the dir attribute on <html>', () => {
    setHtmlDir('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});

// ---------------------------------------------------------------------------
// setHead
// ---------------------------------------------------------------------------

describe('setHead', () => {
  it('applies title, meta, and link in one call', () => {
    setHead({
      title: 'My Page',
      titleTemplate: '%s | Site',
      meta: [
        { name: 'description', content: 'Hello' },
        { property: 'og:title', content: 'My Page' },
      ],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
      htmlLang: 'en',
      themeColor: '#ffffff',
    });

    expect(document.title).toBe('My Page | Site');
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(
      'Hello',
    );
    expect(document.head.querySelector('meta[property="og:title"]')!.getAttribute('content')).toBe(
      'My Page',
    );
    expect(document.head.querySelector('link[rel="icon"]')!.getAttribute('href')).toBe(
      '/favicon.svg',
    );
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.head.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe(
      '#ffffff',
    );
  });

  it('clears managed elements before re-applying', () => {
    setHead({
      meta: [{ name: 'description', content: 'First' }],
    });
    expect(document.head.querySelectorAll('meta[data-utopia-helmet]').length).toBe(1);

    setHead({
      meta: [{ name: 'robots', content: 'noindex' }],
    });
    // First meta should be gone, only new one remains
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
    expect(document.head.querySelectorAll('meta[data-utopia-helmet]').length).toBe(1);
  });

  it('applies htmlDir', () => {
    setHead({ htmlDir: 'rtl' });
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  it('is a no-op for an empty config', () => {
    document.title = 'Untouched';
    setHead({});
    expect(document.title).toBe('Untouched');
    expect(document.head.querySelectorAll('[data-utopia-helmet]').length).toBe(0);
    expect(document.documentElement.getAttribute('lang')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useHead (reactive)
// ---------------------------------------------------------------------------

describe('useHead', () => {
  it('reactively updates head when signals change', async () => {
    const title = signal('Home');
    const desc = signal('Welcome');

    useHead(() => ({
      title: title(),
      meta: [{ name: 'description', content: desc() }],
    }));

    expect(document.title).toBe('Home');
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(
      'Welcome',
    );

    title.set('About');
    desc.set('About page');

    // Effects are synchronous in utopia-core
    expect(document.title).toBe('About');
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(
      'About page',
    );
  });

  it('returns a cleanup function that removes managed elements', () => {
    const cleanup = useHead(() => ({
      title: 'Test',
      meta: [{ name: 'description', content: 'test' }],
    }));

    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull();

    cleanup();
    expect(document.head.querySelector('meta[data-utopia-helmet]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resetHead
// ---------------------------------------------------------------------------

describe('resetHead', () => {
  it('removes all managed elements', () => {
    setMeta({ name: 'description', content: 'test' });
    setLink({ rel: 'icon', href: '/test.svg' });
    expect(document.head.querySelectorAll('[data-utopia-helmet]').length).toBe(2);

    resetHead();
    expect(document.head.querySelectorAll('[data-utopia-helmet]').length).toBe(0);
  });

  it('does not remove non-managed elements', () => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'viewport');
    el.setAttribute('content', 'width=device-width');
    document.head.appendChild(el);

    setMeta({ name: 'description', content: 'test' });
    resetHead();

    expect(document.head.querySelector('meta[name="viewport"]')).not.toBeNull();
  });
});
