/**
 * @matthesketh/utopia-test/plugin — Vitest plugin for <test> block extraction
 *
 * Scans .utopia files for <test> blocks and generates companion .utopia.test.ts
 * files that vitest discovers automatically.
 */

import { parse } from '@matthesketh/utopia-compiler';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UtopiaTestPluginOptions {
  /** Glob patterns to scan for .utopia files. @default ['src/**\/*.utopia'] */
  include?: string[];
  /** Whether to clean up generated files on exit. @default true */
  cleanup?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively find all .utopia files under a directory. */
function findUtopiaFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
      results.push(...findUtopiaFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.utopia')) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Vitest/Vite plugin that extracts `<test>` blocks from `.utopia` files and
 * generates companion `.utopia.test.ts` files for vitest to discover.
 */
export function utopiaTestPlugin(options: UtopiaTestPluginOptions = {}): Plugin {
  const { include = ['src'], cleanup = true } = options;
  const generatedFiles = new Set<string>();

  function generateTestFile(utopiaPath: string): void {
    const source = fs.readFileSync(utopiaPath, 'utf-8');
    let descriptor;
    try {
      descriptor = parse(source, utopiaPath);
    } catch {
      return;
    }

    if (!descriptor.test) return;

    const testContent = descriptor.test.content;
    const basename = path.basename(utopiaPath);
    const testPath = utopiaPath + '.test.ts';

    const output = [
      `// Auto-generated from ${basename} <test> block`,
      `import self from './${basename}';`,
      '',
      testContent.trim(),
      '',
    ].join('\n');

    fs.writeFileSync(testPath, output, 'utf-8');
    generatedFiles.add(testPath);
  }

  function cleanupFiles(): void {
    for (const file of generatedFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        // File may already be deleted.
      }
    }
    generatedFiles.clear();
  }

  return {
    name: 'utopia-test',

    buildStart() {
      // Only generate test files when running under vitest, never during
      // production builds. This is a safety net — even if the plugin is
      // accidentally included in a vite.config used for `utopia build`.
      if (!process.env.VITEST) return;

      const cwd = process.cwd();
      for (const dir of include) {
        const absDir = path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
        const files = findUtopiaFiles(absDir);
        for (const file of files) {
          generateTestFile(file);
        }
      }
    },

    handleHotUpdate(ctx) {
      if (ctx.file.endsWith('.utopia')) {
        generateTestFile(ctx.file);
      }
    },

    buildEnd() {
      if (cleanup) {
        cleanupFiles();
      }
    },
  };
}
