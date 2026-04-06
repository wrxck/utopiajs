# @matthesketh/utopia-helmet

Document head management and adaptive favicon generation. Integrates with UtopiaJS signals for reactive head updates.

## install

```bash
npm install @matthesketh/utopia-helmet
```

## useHead()

Reactive head manager — re-applies when any signals read inside the config function change. Returns a cleanup function.

```ts
import { useHead } from '@matthesketh/utopia-helmet'
import { signal } from '@matthesketh/utopia-core'

const pageTitle = signal('Home')

const cleanup = useHead(() => ({
  title: pageTitle(),
  titleTemplate: '%s | My App',
  htmlLang: 'en',
  meta: [
    { name: 'description', content: 'Welcome to my app' },
    { property: 'og:title', content: pageTitle() },
  ],
  link: [
    { rel: 'canonical', href: 'https://example.com/' },
  ],
}))

// later:
cleanup()  // removes managed elements and stops the effect
```

`HeadConfig` fields:

| field | type | description |
|---|---|---|
| `title` | `string` | document title |
| `titleTemplate` | `string` | e.g. `'%s \| My App'` |
| `htmlLang` | `string` | sets `<html lang="">` |
| `htmlDir` | `'ltr' \| 'rtl' \| 'auto'` | sets `<html dir="">` |
| `themeColor` | `string` | `<meta name="theme-color">` |
| `meta` | `MetaDescriptor[]` | meta tags |
| `link` | `LinkDescriptor[]` | link tags |

## setHead()

Apply a head config imperatively (not reactive).

```ts
import { setHead } from '@matthesketh/utopia-helmet'

setHead({
  title: 'About',
  meta: [{ name: 'robots', content: 'noindex' }],
})
```

## individual setters

```ts
import { setTitle, setMeta, setLink, setHtmlLang, setHtmlDir } from '@matthesketh/utopia-helmet'

setTitle('My Page', '%s | My App')
setMeta({ name: 'description', content: 'Hello' })
setMeta({ property: 'og:image', content: 'https://example.com/og.png' })
setLink({ rel: 'stylesheet', href: '/styles.css' })
setHtmlLang('fr')
setHtmlDir('rtl')
```

## resetHead()

Remove all helmet-managed elements from `<head>`. Useful in tests or HMR.

```ts
import { resetHead } from '@matthesketh/utopia-helmet'

resetHead()
```

## favicon generation

```ts
import { generateFaviconSvg, generateManifest, faviconLinks } from '@matthesketh/utopia-helmet'

// generate an adaptive SVG favicon (light/dark mode)
const svg = generateFaviconSvg({
  text: 'A',
  bgLight: '#ffffff',
  bgDark: '#1a1a1a',
  color: '#0066cc',
})

// generate a web app manifest
const manifest = generateManifest({
  name: 'My App',
  shortName: 'App',
  themeColor: '#0066cc',
})

// get recommended <link> tags for favicons
const links = faviconLinks('/favicon.svg')
```
