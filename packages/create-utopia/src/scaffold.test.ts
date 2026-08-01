// @vitest-environment node
// ============================================================================
// create-utopia — scaffoldProject() and helper tests (real FS, temp dirs)
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  copyDir,
  detectPackageManager,
  getPackageManagerCommands,
  initGitRepo,
  isDirectInvocation,
  isEmptyDir,
  isValidPackageName,
  listFiles,
  type ProjectOptions,
  removeDir,
  renameFile,
  scaffoldProject,
  stripAnsi,
  toValidPackageName,
} from './index';

const SCRATCH = process.env.CLAUDE_SCRATCHPAD ?? os.tmpdir();

let tmpDir: string;

beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(SCRATCH, 'create-utopia-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function options(overrides: Partial<ProjectOptions> = {}): ProjectOptions {
  return {
    projectName: 'my-app',
    language: 'typescript',
    useRouter: true,
    useSSR: false,
    useEmail: false,
    useAI: false,
    useContent: false,
    cssPreprocessor: 'none',
    initGit: false,
    ...overrides,
  };
}

function scaffold(overrides: Partial<ProjectOptions> = {}): string {
  const root = path.join(tmpDir, 'app');
  scaffoldProject(root, options(overrides));
  return root;
}

function readJson(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// =========================================================================
// Default (TypeScript + router)
// =========================================================================

describe('scaffoldProject — defaults', () => {
  it('copies the template and replaces the project name placeholder', () => {
    const root = scaffold();
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.name).toBe('my-app');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
    expect(html).toContain('<title>my-app</title>');
    expect(html).not.toContain('{{projectName}}');
  });

  it('keeps the router dependency and routes directory', () => {
    const root = scaffold();
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies['@matthesketh/utopia-router']).toBeDefined();
    expect(fs.existsSync(path.join(root, 'src', 'routes', '+page.utopia'))).toBe(true);
  });

  it('does not copy SSR files for a client-only project', () => {
    const root = scaffold();
    expect(fs.existsSync(path.join(root, 'server.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'entry-server.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'entry-client.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(true);
  });
});

// =========================================================================
// No router
// =========================================================================

describe('scaffoldProject — without router', () => {
  it('removes the router dependency and routes, simplifies App and main', () => {
    const root = scaffold({ useRouter: false });
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies['@matthesketh/utopia-router']).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'src', 'routes'))).toBe(false);

    const app = fs.readFileSync(path.join(root, 'src', 'App.utopia'), 'utf-8');
    expect(app).toContain('Welcome to UtopiaJS');
    expect(app).not.toContain('RouterView');

    const main = fs.readFileSync(path.join(root, 'src', 'main.ts'), 'utf-8');
    expect(main).toContain("mount(App, '#app')");
    expect(main).not.toContain('createRouter');
  });
});

// =========================================================================
// JavaScript
// =========================================================================

describe('scaffoldProject — JavaScript', () => {
  it('renames entry files, drops tsconfig and the typescript dependency', () => {
    const root = scaffold({ language: 'javascript' });
    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'vite.config.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'vite.config.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'main.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(false);

    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.devDependencies['typescript']).toBeUndefined();

    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
    expect(html).toContain('/src/main.js');
    expect(html).not.toContain('/src/main.ts');
  });
});

// =========================================================================
// SSR
// =========================================================================

describe('scaffoldProject — SSR', () => {
  it('adds server deps, SSR scripts and markers, removes main.ts', () => {
    const root = scaffold({ useSSR: true });
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies['@matthesketh/utopia-server']).toBeDefined();
    expect(pkg.dependencies['express']).toBeDefined();
    expect(pkg.scripts['build:server']).toBe(
      'vite build --outDir dist/server --ssr src/entry-server.ts',
    );

    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
    expect(html).toContain('<!--ssr-head-->');
    expect(html).toContain('<!--ssr-outlet-->');
    expect(html).toContain('/src/entry-client.ts');

    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'server.js'))).toBe(true);
  });

  it('moves vite into dependencies without leaving a devDependencies duplicate', () => {
    const root = scaffold({ useSSR: true });
    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies['vite']).toBeDefined();
    expect(pkg.devDependencies['vite']).toBeUndefined();
  });

  it('JS + SSR: build:server points at the renamed .js entry (bug fix)', () => {
    const root = scaffold({ useSSR: true, language: 'javascript' });
    expect(fs.existsSync(path.join(root, 'src', 'entry-server.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'entry-server.ts'))).toBe(false);

    const pkg = readJson(path.join(root, 'package.json'));
    // Previously referenced src/entry-server.ts, which no longer exists.
    expect(pkg.scripts['build:server']).toBe(
      'vite build --outDir dist/server --ssr src/entry-server.js',
    );

    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
    expect(html).toContain('/src/entry-client.js');

    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf-8');
    expect(server).toContain('entry-server.js');
    expect(server).not.toContain('entry-server.ts');
  });

  it('SSR without router does not recreate a stray main entry (bug fix)', () => {
    const root = scaffold({ useSSR: true, useRouter: false });
    // SSR projects mount via entry-client/entry-server; a recreated main.ts
    // would be dead code that double-mounts if ever imported.
    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'main.js'))).toBe(false);
    // App is still simplified.
    const app = fs.readFileSync(path.join(root, 'src', 'App.utopia'), 'utf-8');
    expect(app).not.toContain('RouterView');
  });
});

// =========================================================================
// Feature dependencies
// =========================================================================

describe('scaffoldProject — optional features', () => {
  it('adds sass or less when a CSS preprocessor is chosen', () => {
    let pkg = readJson(path.join(scaffold({ cssPreprocessor: 'sass' }), 'package.json'));
    expect(pkg.devDependencies['sass']).toBeDefined();
    expect(pkg.devDependencies['less']).toBeUndefined();

    fs.rmSync(path.join(tmpDir, 'app'), { recursive: true, force: true });
    pkg = readJson(path.join(scaffold({ cssPreprocessor: 'less' }), 'package.json'));
    expect(pkg.devDependencies['less']).toBeDefined();
  });

  it('adds the email dependency when selected', () => {
    const pkg = readJson(path.join(scaffold({ useEmail: true }), 'package.json'));
    expect(pkg.dependencies['@matthesketh/utopia-email']).toBeDefined();
  });

  it('scaffolds an AI chat route and .env.example when AI + router are selected', () => {
    const root = scaffold({ useAI: true });
    const serverFile = path.join(root, 'src', 'routes', 'api', 'chat', '+server.ts');
    expect(fs.existsSync(serverFile)).toBe(true);
    const content = fs.readFileSync(serverFile, 'utf-8');
    expect(content).toContain('createAI');
    expect(content).toContain(': any');
    expect(fs.readFileSync(path.join(root, '.env.example'), 'utf-8')).toContain('OPENAI_API_KEY');

    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies['@matthesketh/utopia-ai']).toBeDefined();
  });

  it('AI without router only writes .env.example (no API route)', () => {
    const root = scaffold({ useAI: true, useRouter: false });
    expect(fs.existsSync(path.join(root, 'src', 'routes'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.env.example'))).toBe(true);
  });

  it('AI + JavaScript writes an untyped .js route', () => {
    const root = scaffold({ useAI: true, language: 'javascript' });
    const serverFile = path.join(root, 'src', 'routes', 'api', 'chat', '+server.js');
    expect(fs.existsSync(serverFile)).toBe(true);
    expect(fs.readFileSync(serverFile, 'utf-8')).not.toContain(': any');
  });

  it('scaffolds content collection, config, vite plugin wiring and blog routes', () => {
    const root = scaffold({ useContent: true });

    expect(fs.existsSync(path.join(root, 'content', 'blog', 'hello-world.md'))).toBe(true);
    const config = fs.readFileSync(path.join(root, 'content.config.ts'), 'utf-8');
    expect(config).toContain('defineCollection');

    const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf-8');
    expect(viteConfig).toContain("import content from '@matthesketh/utopia-content/vite'");
    expect(viteConfig).toContain("plugins: [utopia(), content({ contentDir: 'content' })]");

    expect(fs.existsSync(path.join(root, 'src', 'routes', 'blog', '+page.utopia'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'routes', 'blog', '[slug]', '+page.utopia'))).toBe(
      true,
    );

    const pkg = readJson(path.join(root, 'package.json'));
    expect(pkg.dependencies['@matthesketh/utopia-content']).toBeDefined();
  });

  it('content without router skips blog routes but keeps content files', () => {
    const root = scaffold({ useContent: true, useRouter: false });
    expect(fs.existsSync(path.join(root, 'content', 'blog', 'hello-world.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src', 'routes'))).toBe(false);
  });

  it('content + JavaScript writes content.config.js and patches vite.config.js', () => {
    const root = scaffold({ useContent: true, language: 'javascript' });
    expect(fs.existsSync(path.join(root, 'content.config.js'))).toBe(true);
    const viteConfig = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf-8');
    expect(viteConfig).toContain('@matthesketh/utopia-content/vite');
  });
});

// =========================================================================
// Helpers
// =========================================================================

describe('scaffoldProject — JavaScript without router', () => {
  it('writes the simplified main entry as main.js', () => {
    const root = scaffold({ language: 'javascript', useRouter: false });
    const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf-8');
    expect(main).toContain("mount(App, '#app')");
    expect(fs.existsSync(path.join(root, 'src', 'main.ts'))).toBe(false);
  });
});

describe('fs helpers', () => {
  it('removeDir ignores missing directories and removes populated ones', () => {
    expect(() => removeDir(path.join(tmpDir, 'missing'))).not.toThrow();

    const dir = path.join(tmpDir, 'todelete');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'f.txt'), 'x');
    removeDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('renameFile renames existing files and skips missing ones', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x');
    renameFile(tmpDir, 'a.txt', 'b.txt');
    expect(fs.existsSync(path.join(tmpDir, 'b.txt'))).toBe(true);

    expect(() => renameFile(tmpDir, 'nope.txt', 'c.txt')).not.toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'c.txt'))).toBe(false);
  });
});

describe('package name helpers', () => {
  it('validates npm package names', () => {
    expect(isValidPackageName('my-app')).toBe(true);
    expect(isValidPackageName('@scope/pkg')).toBe(true);
    expect(isValidPackageName('My App')).toBe(false);
    expect(isValidPackageName('')).toBe(false);
    expect(isValidPackageName('.hidden')).toBe(false);
  });

  it('sanitizes arbitrary strings into valid names', () => {
    expect(toValidPackageName('  My Cool App! ')).toBe('my-cool-app-');
    expect(toValidPackageName('.leading')).toBe('leading');
    expect(toValidPackageName('_under')).toBe('under');
    expect(isValidPackageName(toValidPackageName('Some Project'))).toBe(true);
  });
});

describe('isEmptyDir', () => {
  it('treats missing and empty directories as empty', () => {
    expect(isEmptyDir(path.join(tmpDir, 'nope'))).toBe(true);
    const dir = path.join(tmpDir, 'empty');
    fs.mkdirSync(dir);
    expect(isEmptyDir(dir)).toBe(true);
  });

  it('treats a directory containing only .git as empty', () => {
    const dir = path.join(tmpDir, 'gitonly');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    expect(isEmptyDir(dir)).toBe(true);
  });

  it('treats a directory with files as non-empty', () => {
    const dir = path.join(tmpDir, 'full');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    expect(isEmptyDir(dir)).toBe(false);
  });
});

describe('copyDir', () => {
  it('skips entries listed in the skip set including nested paths', () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(src, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(src, 'skip.txt'), 'skip');
    fs.writeFileSync(path.join(src, 'sub', 'deep', 'nested.txt'), 'nested');

    const dest = path.join(tmpDir, 'dest');
    copyDir(src, dest, new Set(['skip.txt', path.join('sub', 'deep')]));

    expect(fs.existsSync(path.join(dest, 'keep.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'skip.txt'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'sub'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'sub', 'deep'))).toBe(false);
  });
});

describe('package manager detection', () => {
  const original = process.env['npm_config_user_agent'];

  afterEach(() => {
    if (original === undefined) delete process.env['npm_config_user_agent'];
    else process.env['npm_config_user_agent'] = original;
  });

  it.each([
    ['yarn/1.22.19 npm/? node/v20', 'yarn'],
    ['pnpm/9.0.0 npm/? node/v20', 'pnpm'],
    ['bun/1.1.0 npm/? node/v20', 'bun'],
    ['npm/10.0.0 node/v20', 'npm'],
  ])('detects %s as %s', (agent, expected) => {
    process.env['npm_config_user_agent'] = agent;
    expect(detectPackageManager()).toBe(expected);
  });

  it('falls back to npm when the user agent is missing', () => {
    delete process.env['npm_config_user_agent'];
    expect(detectPackageManager()).toBe('npm');
  });

  it('maps package managers to install/dev commands', () => {
    expect(getPackageManagerCommands('yarn')).toEqual({ install: 'yarn', dev: 'yarn dev' });
    expect(getPackageManagerCommands('pnpm')).toEqual({
      install: 'pnpm install',
      dev: 'pnpm dev',
    });
    expect(getPackageManagerCommands('bun')).toEqual({ install: 'bun install', dev: 'bun dev' });
    expect(getPackageManagerCommands('npm')).toEqual({
      install: 'npm install',
      dev: 'npm run dev',
    });
  });
});

describe('stripAnsi', () => {
  it('removes ANSI color codes', () => {
    expect(stripAnsi('[32mgreen[0m')).toBe('green');
    expect(stripAnsi('plain')).toBe('plain');
  });
});

describe('listFiles', () => {
  it('lists files recursively relative to the base', () => {
    const dir = path.join(tmpDir, 'tree');
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'root.txt'), '');
    fs.writeFileSync(path.join(dir, 'a', 'b', 'leaf.txt'), '');

    const files = listFiles(dir, dir).sort();
    expect(files).toEqual([path.join('a', 'b', 'leaf.txt'), 'root.txt'].sort());
  });

  it('returns an empty list for a missing directory', () => {
    expect(listFiles(path.join(tmpDir, 'missing'), tmpDir)).toEqual([]);
  });
});

describe('initGitRepo', () => {
  it('initializes a repository and makes an initial commit', () => {
    const dir = path.join(tmpDir, 'gitrepo');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');

    const env = { ...process.env };
    process.env['GIT_AUTHOR_NAME'] = 'Test';
    process.env['GIT_AUTHOR_EMAIL'] = 'test@example.com';
    process.env['GIT_COMMITTER_NAME'] = 'Test';
    process.env['GIT_COMMITTER_EMAIL'] = 'test@example.com';
    try {
      const ok = initGitRepo(dir);
      expect(ok).toBe(true);
      expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
    } finally {
      process.env = env;
    }
  });

  it('returns false when git cannot run', () => {
    // A path that exists as a file, not a directory — git init must fail.
    const filePath = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(filePath, '');
    expect(initGitRepo(filePath)).toBe(false);
  });
});

describe('isDirectInvocation', () => {
  it('is false for missing argv[1] and for non-matching paths', () => {
    expect(isDirectInvocation(undefined)).toBe(false);
    expect(isDirectInvocation('/definitely/not/a/real/path.js')).toBe(false);
    expect(isDirectInvocation(process.argv[1])).toBe(false);
  });

  it('is true when argv[1] resolves to this module', () => {
    const self = new URL(import.meta.url).pathname;
    expect(isDirectInvocation(self, import.meta.url)).toBe(true);
  });
});
