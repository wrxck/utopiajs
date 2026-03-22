import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@matthesketh/utopia-core';
import {
  setTitle,
  setMeta,
  setLink,
  setHead,
  useHead,
  resetHead,
  setHtmlLang,
  setHtmlDir,
} from './head';

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
