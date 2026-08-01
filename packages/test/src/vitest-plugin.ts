/**
 * @matthesketh/utopia-test/plugin — Vitest plugin for <test> block extraction
 *
 * Scans .utopia files for <test> blocks and generates companion .utopia.test.ts
 * files that vitest discovers automatically.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse } from '@matthesketh/utopia-compiler';
import type { Plugin } from 'vite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UtopiaTestPluginOptions {
  /**
   * Directories to scan recursively for .utopia files. Relative paths are
   * resolved against the current working directory.
   * @default ['src']
   */
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

  function removeGeneratedFile(testPath: string): void {
    if (!generatedFiles.has(testPath)) return;
    try {
      fs.unlinkSync(testPath);
    } catch {
      // File may already be deleted.
    }
    generatedFiles.delete(testPath);
  }

  function generateTestFile(utopiaPath: string): void {
    const testPath = utopiaPath + '.test.ts';

    const source = fs.readFileSync(utopiaPath, 'utf-8');
    let descriptor;
    try {
      descriptor = parse(source, utopiaPath);
    } catch {
      return;
    }

    if (!descriptor.test) {
      // The <test> block was removed — drop any previously generated file so
      // vitest stops running tests that no longer exist in source.
      removeGeneratedFile(testPath);
      return;
    }

    const testContent = descriptor.test.content;
    const basename = path.basename(utopiaPath);

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
    for (const file of [...generatedFiles]) {
      removeGeneratedFile(file);
    }
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
      // Same guard as buildStart: never write generated files into the
      // source tree outside a vitest run (e.g. during `utopia dev`).
      if (!process.env.VITEST) return;
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
