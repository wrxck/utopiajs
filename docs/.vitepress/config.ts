import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'UtopiaJS',
  description: 'A compiler-first, signal-based UI framework with single-file components',
  base: '/',
  cleanUrls: true,
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'UtopiaJS',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Packages', link: '/packages/core' },
      { text: 'GitHub', link: 'https://github.com/wrxck/utopiajs' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/architecture' },
            { text: 'SSR', link: '/ssr' },
          ],
        },
      ],
      '/packages/': [
        {
          text: 'Packages',
          items: [
            { text: 'Core', link: '/packages/core' },
            { text: 'Router', link: '/packages/router' },
            { text: 'Server', link: '/packages/server' },
            { text: 'Content', link: '/content' },
            { text: 'Database', link: '/database' },
            { text: 'AI', link: '/ai' },
            { text: 'Email', link: '/email' },
            { text: 'Helmet', link: '/packages/helmet' },
            { text: 'Vite Plugin', link: '/packages/vite-plugin' },
            { text: 'CLI', link: '/packages/cli' },
            { text: 'Test', link: '/packages/test' },
          ],
        },
      ],
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture', link: '/architecture' },
            { text: 'SSR', link: '/ssr' },
          ],
        },
        {
          text: 'Packages',
          items: [
            { text: 'Core', link: '/packages/core' },
            { text: 'Database', link: '/database' },
            { text: 'AI', link: '/ai' },
            { text: 'Content', link: '/content' },
            { text: 'Email', link: '/email' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/wrxck/utopiajs' },
      { icon: 'npm', link: 'https://www.npmjs.com/org/matthesketh' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT Licence.',
      copyright: 'Copyright 2026 Matt Hesketh',
    },
  },
})
