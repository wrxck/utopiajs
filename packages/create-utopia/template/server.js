import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHandler } from '@matthesketh/utopia-server';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

async function createServer() {
  const app = express();

  let vite;

  if (!isProduction) {
    // In development, use Vite's dev server as middleware
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve the built client assets
    app.use(express.static(path.resolve(__dirname, 'dist/client')));
  }

  app.use('*', async (req, res) => {
    // express rewrites req.url under a mount; the handler needs the real one.
    req.url = req.originalUrl;

    try {
      let template;
      let entry;

      if (!isProduction) {
        // In dev, read index.html and transform it through Vite
        template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.url, template);

        // Load the server entry through Vite so it gets HMR
        entry = await vite.ssrLoadModule('/src/entry-server.ts');
      } else {
        // In production, use the pre-built files
        template = fs.readFileSync(path.resolve(__dirname, 'dist/client/index.html'), 'utf-8');
        entry = await import('./dist/server/entry-server.js');
      }

      // createHandler serves +server API routes, renders the page into the
      // <!--ssr-outlet--> and <!--ssr-head--> markers, and sets baseline
      // security headers.
      const handler = createHandler({
        template,
        apiRoutes: entry.apiManifest,
        render: async (url) => {
          try {
            return await entry.render(url);
          } catch (e) {
            if (!isProduction) vite.ssrFixStacktrace(e);
            throw e;
          }
        },
      });
      await handler(req, res);
    } catch (e) {
      if (!isProduction) {
        vite.ssrFixStacktrace(e);
      }
      console.error(e);
      res.status(500).end('Internal Server Error');
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

createServer();
