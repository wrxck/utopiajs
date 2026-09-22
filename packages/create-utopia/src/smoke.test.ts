// @vitest-environment node
// ============================================================================
// create-utopia — Smoke test (FS-only, no npm install or dev server)
// ============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  it('template package.json leaves framework versions to the scaffolder', () => {
    const pkg = JSON.parse(readTemplateFile('package.json'));
    const deps = pkg.dependencies;
    const devDeps = pkg.devDependencies;

    // replaced with this CLI's own version at scaffold time (a hard-coded
    // ^0.7.0 installed a months-old release into every new project).
    expect(deps['@matthesketh/utopia-core']).toBe('{{utopiaVersion}}');
    expect(deps['@matthesketh/utopia-runtime']).toBe('{{utopiaVersion}}');
    expect(deps['@matthesketh/utopia-router']).toBe('{{utopiaVersion}}');
    expect(devDeps['@matthesketh/utopia-cli']).toBe('{{utopiaVersion}}');
    expect(devDeps['@matthesketh/utopia-test']).toBe('{{utopiaVersion}}');
    expect(devDeps['@matthesketh/utopia-vite-plugin']).toBe('{{utopiaVersion}}');
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

  it('App.utopia uses createRouterView itself as the RouterView component', () => {
    const content = readTemplateFile('src/App.utopia');
    // createRouterView is a component factory. wrapping it as
    // `{ render() { return createRouterView() } }` returned a definition where
    // a DOM node was due, and every scaffolded app crashed on mount.
    expect(content).toContain(
      "import { createRouterView as RouterView } from '@matthesketh/utopia-router'",
    );
    expect(content).not.toContain('render()');
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
    expect(fs.existsSync(path.join(TEMPLATE_DIR, 'src', 'routes', 'about', '+page.utopia'))).toBe(
      true,
    );
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
