# @matthesketh/utopia-helmet

Document head management and favicon generation for UtopiaJS.

## Install

```bash
pnpm add @matthesketh/utopia-helmet
```

## Usage

### Head management

```ts
import { setHead, useHead } from '@matthesketh/utopia-helmet';
import { signal } from '@matthesketh/utopia-core';

// Static — set once
setHead({
  title: 'Home',
  titleTemplate: '%s | My Site',
  htmlLang: 'en',
  themeColor: '#ffffff',
  meta: [
    { name: 'description', content: 'Welcome to my site' },
    { property: 'og:title', content: 'Home' },
  ],
  link: [
    { rel: 'canonical', href: 'https://example.com/' },
  ],
});

// Reactive — updates automatically when signals change
const title = signal('Home');

useHead(() => ({
  title: title(),
  titleTemplate: '%s | My Site',
  meta: [
    { name: 'description', content: `${title()} page` },
  ],
}));

title.set('About'); // head updates automatically
```

### Favicon generation

Generate adaptive SVG favicons with automatic dark mode support:

```ts
import { generateFaviconSvg, generateStaticSvg, generateMaskSvg } from '@matthesketh/utopia-helmet';

// Adaptive favicon (dark mode via prefers-color-scheme)
const favicon = generateFaviconSvg('M', {
  fontFamily: "'DM Mono', monospace",
  bg: '#ffffff',
  fg: '#000000',
  darkBg: '#000000',
  darkFg: '#ffffff',
  radius: 12,
});

// Static variant (for Apple touch icon, no media queries)
const touchIcon = generateStaticSvg('M', {
  bg: '#ffffff',
  fg: '#000000',
});

// Mask icon (monochrome, for Safari pinned tabs)
const mask = generateMaskSvg('M');
```

### Web manifest

```ts
import { generateManifest } from '@matthesketh/utopia-helmet';

const manifest = generateManifest({
  appName: 'My App',
  shortName: 'App',
  themeColor: '#ffffff',
  backgroundColor: '#ffffff',
  iconPath: '/icons',
});

// Write to public/site.webmanifest
console.log(JSON.stringify(manifest, null, 2));
```

### Favicon link tags

Generate all the `<link>` tags needed for a complete favicon setup:

```ts
import { faviconLinks, setHead } from '@matthesketh/utopia-helmet';

const links = faviconLinks({
  svgPath: '/favicon.svg',
  appleTouchPath: '/apple-touch-icon.png',
  manifestPath: '/site.webmanifest',
  maskPath: '/mask-icon.svg',
  maskColor: '#000000',
  icon32Path: '/favicon-32x32.png',
  icon16Path: '/favicon-16x16.png',
});

setHead({ link: links });
```

## API

### Head management

| Export | Description |
| --- | --- |
| `setTitle(title, template?)` | Set document title, optionally with a `%s` template |
| `setMeta(descriptor)` | Set or update a single `<meta>` tag |
| `setLink(descriptor)` | Set or update a single `<link>` tag |
| `setHtmlLang(lang)` | Set the `lang` attribute on `<html>` |
| `setHtmlDir(dir)` | Set the `dir` attribute on `<html>` |
| `setHead(config)` | Apply a full head configuration (clears previous managed elements) |
| `useHead(configFn)` | Reactive head — re-applies when signals in `configFn` change |
| `resetHead()` | Remove all helmet-managed elements from `<head>` |

### Favicon generation

| Export | Description |
| --- | --- |
| `generateFaviconSvg(char, options?)` | SVG with dark mode via `prefers-color-scheme` media query |
| `generateStaticSvg(char, options?)` | Static SVG without media queries (for touch icons) |
| `generateMaskSvg(char, options?)` | Monochrome SVG without background (for Safari mask) |
| `generateManifest(config)` | Web app manifest with icon entries |
| `faviconLinks(options?)` | Array of `LinkDescriptor` for all favicon variants |

### Types

| Type | Description |
| --- | --- |
| `HeadConfig` | Full head configuration object |
| `MetaDescriptor` | Attributes for a `<meta>` element |
| `LinkDescriptor` | Attributes for a `<link>` element |
| `FaviconConfig` | Favicon generation configuration |
| `WebManifest` | Web app manifest structure |
| `ManifestIcon` | Icon entry in a web manifest |

## License

MIT
