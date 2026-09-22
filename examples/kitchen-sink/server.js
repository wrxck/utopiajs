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
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist/client')));
  }

  app.use('*', async (req, res) => {
    // express rewrites req.url under a mount; the handler needs the real one.
    req.url = req.originalUrl;

    try {
      let template, entry;

      if (!isProduction) {
        template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.url, template);
        entry = await vite.ssrLoadModule('/src/entry-server.ts');
      } else {
        template = fs.readFileSync(path.resolve(__dirname, 'dist/client/index.html'), 'utf-8');
        entry = await import('./dist/server/entry-server.js');
      }

      // createHandler serves the +server API routes, renders the page into the
      // <!--ssr-outlet--> and <!--ssr-head--> markers, and sets baseline
      // security headers.
      await createHandler({
        template,
        apiRoutes: entry.apiManifest,
        render: (url) => entry.render(url),
      })(req, res);
    } catch (e) {
      if (!isProduction) vite.ssrFixStacktrace(e);
      console.error(e);
      res.status(500).end('Internal Server Error');
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Kitchen Sink running at http://localhost:${port}`);
  });
}

createServer();
