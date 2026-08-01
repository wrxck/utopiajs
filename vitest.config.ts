import path from 'path';
import { defineConfig } from 'vitest/config';

// resolves `@/x` to the importing file's OWN package src (packages/<name>/src/x),
// mirroring the per-package tsconfig `paths` so the test runner matches the build.
const localAlias = {
  name: 'utopia-local-alias',
  enforce: 'pre' as const,
  async resolveId(source: string, importer: string | undefined, options: unknown) {
    if (!source.startsWith('@/') || !importer) return null;
    const m = importer.replace(/\\/g, '/').match(/^(.*\/packages\/[^/]+\/src)\//);
    if (!m) return null;
    const target = path.resolve(m[1], source.slice(2));
    const resolved = await (this as { resolve: Function }).resolve(target, importer, {
      skipSelf: true,
      ...(options as object),
    });
    return resolved ?? null;
  },
};

export default defineConfig({
  plugins: [localAlias],
  resolve: {
    alias: {
      '@matthesketh/utopia-compiler': path.resolve(__dirname, 'packages/compiler/src/index.ts'),
      '@matthesketh/utopia-core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@matthesketh/utopia-runtime': path.resolve(__dirname, 'packages/runtime/src/index.ts'),
      '@matthesketh/utopia-router': path.resolve(__dirname, 'packages/router/src/index.ts'),
      '@matthesketh/utopia-server/ssr-runtime': path.resolve(
        __dirname,
        'packages/server/src/ssr-runtime.ts',
      ),
      '@matthesketh/utopia-server': path.resolve(__dirname, 'packages/server/src/index.ts'),
      '@matthesketh/utopia-email': path.resolve(__dirname, 'packages/email/src/index.ts'),
      '@matthesketh/utopia-ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@matthesketh/utopia-ai/mcp': path.resolve(__dirname, 'packages/ai/src/mcp/index.ts'),
      '@matthesketh/utopia-vite-plugin': path.resolve(
        __dirname,
        'packages/vite-plugin/src/index.ts',
      ),
      '@matthesketh/utopia-test/plugin': path.resolve(
        __dirname,
        'packages/test/src/vitest-plugin.ts',
      ),
      '@matthesketh/utopia-test': path.resolve(__dirname, 'packages/test/src/index.ts'),
      '@matthesketh/utopia-content/mcp': path.resolve(
        __dirname,
        'packages/content/src/mcp/index.ts',
      ),
      '@matthesketh/utopia-content/vite': path.resolve(__dirname, 'packages/content/src/vite.ts'),
      '@matthesketh/utopia-content': path.resolve(__dirname, 'packages/content/src/index.ts'),
      '@matthesketh/utopia-helmet': path.resolve(__dirname, 'packages/helmet/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['packages/*/src/**/*.test.ts'],
  },
});
