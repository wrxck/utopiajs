// @vitest-environment node
// ============================================================================
// create-utopia — Smoke test (FS-only, no npm install or dev server)
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'template');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function readTemplateFile(relativePath: string): string {
  return fs.readFileSync(path.join(TEMPLATE_DIR, relativePath), 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-utopia-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// =========================================================================
// Template integrity
// =========================================================================

describe('template integrity', () => {
  it('template package.json has v0.7.0 dependency versions', () => {
    const pkg = JSON.parse(readTemplateFile('package.json'));
    const deps = pkg.dependencies;
    const devDeps = pkg.devDependencies;

    // All utopia packages should reference ^0.7.0
    expect(deps['@matthesketh/utopia-core']).toBe('^0.7.0');
    expect(deps['@matthesketh/utopia-runtime']).toBe('^0.7.0');
    expect(deps['@matthesketh/utopia-router']).toBe('^0.7.0');
    expect(devDeps['@matthesketh/utopia-cli']).toBe('^0.7.0');
    expect(devDeps['@matthesketh/utopia-test']).toBe('^0.7.0');
    expect(devDeps['@matthesketh/utopia-vite-plugin']).toBe('^0.7.0');
  });

  it('main.ts exists and imports virtual:utopia-routes', () => {
    const content = readTemplateFile('src/main.ts');
    expect(content).toContain("import routes from 'virtual:utopia-routes'");
    expect(content).toContain('createRouter(routes)');
    expect(content).toContain('mount(App');
  });

  it('App.utopia exists and is valid', () => {
    const content = readTemplateFile('src/App.utopia');
    expect(content).toContain('<template>');
    expect(content).toContain('</template>');
    expect(content).toContain('<script>');
    expect(content).toContain('</script>');
    expect(content).toContain('RouterView');
  });

  it('App.utopia wraps createRouterView as a component definition', () => {
    const content = readTemplateFile('src/App.utopia');
    expect(content).toContain('createRouterView');
    // Should define RouterView as an object with render(), not just alias the import
    expect(content).toContain('render()');
  });

  it('entry-client.ts exists for SSR setup', () => {
    const content = readTemplateFile('src/entry-client.ts');
    expect(content).toBeTruthy();
  });

  it('entry-server.ts exists for SSR setup', () => {
    const content = readTemplateFile('src/entry-server.ts');
    expect(content).toBeTruthy();
  });

  it('route files exist', () => {
    expect(fs.existsSync(path.join(TEMPLATE_DIR, 'src', 'routes', '+page.utopia'))).toBe(true);
    expect(fs.existsSync(path.join(TEMPLATE_DIR, 'src', 'routes', '+layout.utopia'))).toBe(true);
    expect(fs.existsSync(path.join(TEMPLATE_DIR, 'src', 'routes', 'about', '+page.utopia'))).toBe(true);
  });

  it('vite.config.ts exists', () => {
    expect(fs.existsSync(path.join(TEMPLATE_DIR, 'vite.config.ts'))).toBe(true);
  });

  it('no stale version references remain in template', () => {
    const pkg = readTemplateFile('package.json');
    // Should not contain old versions
    expect(pkg).not.toContain('"^0.3.0"');
    expect(pkg).not.toContain('"^0.4.0"');
  });
});
