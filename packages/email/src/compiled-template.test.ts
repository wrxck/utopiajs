// @vitest-environment node
/**
 * An email written as a .utopia component keeps its styles.
 *
 * The compiler never put a component's CSS on its definition, so
 * renderToString returned no CSS for a compiled component and renderEmail had
 * nothing to inline: every .utopia email went out unstyled. Server builds now
 * compile with `emitStyles`.
 */

import { compile } from '@matthesketh/utopia-compiler';
import * as ssr from '@matthesketh/utopia-server/ssr-runtime';
import { describe, expect, it } from 'vitest';

import { renderEmail } from '@/render-email';

/** Compile a template the way a server build does and evaluate it. */
function loadEmail(source: string): unknown {
  const { code } = compile(source, { filename: 'Welcome.utopia', emitStyles: true });
  const body = code
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace('export default', 'return');
  const helpers = ssr as unknown as Record<string, unknown>;
  return new Function(...Object.keys(helpers), body)(...Object.values(helpers));
}

describe('renderEmail with a compiled template', () => {
  it('inlines the component style block', () => {
    const Welcome = loadEmail(
      '<template><p class="hi">Hello</p></template><style>.hi { color: red; }</style>',
    );
    const { html } = renderEmail(Welcome);
    expect(html).toContain('<p class="hi" style="color: red">Hello</p>');
  });
});
