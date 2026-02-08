import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@utopia/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@utopia/runtime': path.resolve(__dirname, 'packages/runtime/src/index.ts'),
      '@utopia/router': path.resolve(__dirname, 'packages/router/src/index.ts'),
      '@utopia/server/ssr-runtime': path.resolve(__dirname, 'packages/server/src/ssr-runtime.ts'),
      '@utopia/server': path.resolve(__dirname, 'packages/server/src/index.ts'),
      '@utopia/email': path.resolve(__dirname, 'packages/email/src/index.ts'),
      '@utopia/ai': path.resolve(__dirname, 'packages/ai/src/index.ts'),
      '@utopia/ai/mcp': path.resolve(__dirname, 'packages/ai/src/mcp/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['packages/*/src/**/*.test.ts'],
  },
})
