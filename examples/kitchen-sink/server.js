import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production'

async function createServer() {
  const app = express()
  let vite

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite')
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    })
    app.use(vite.middlewares)
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist/client')))
  }

  app.use('*', async (req, res) => {
    const url = req.originalUrl

    try {
      let template, render

      if (!isProduction) {
        template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8')
        template = await vite.transformIndexHtml(url, template)
        const mod = await vite.ssrLoadModule('/src/entry-server.ts')
        render = mod.render
      } else {
        template = fs.readFileSync(
          path.resolve(__dirname, 'dist/client/index.html'), 'utf-8')
        const mod = await import('./dist/server/entry-server.js')
        render = mod.render
      }

      const { html: appHtml, css } = render(url)
      let page = template
      page = page.replace('<!--ssr-head-->', css ? `<style>${css}</style>` : '')
      page = page.replace('<!--ssr-outlet-->', appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(page)
    } catch (e) {
      if (!isProduction) vite.ssrFixStacktrace(e)
      console.error(e)
      res.status(500).end(e.message)
    }
  })

  const port = process.env.PORT || 3000
  app.listen(port, () => {
    console.log(`Kitchen Sink running at http://localhost:${port}`)
  })
}

createServer()
