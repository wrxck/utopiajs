import { describe, expect, it } from 'vitest';

import { fromProbePath, isProbePath, isUtopiaFile, toScriptText } from './utopia';

describe('toScriptText', () => {
  it('keeps the script body and blanks everything else, preserving offsets', () => {
    const source =
      '<template>\n  <p>{{ x }}</p>\n</template>\n<script lang="ts">\nconst x = 1;\n</script>\n';
    const text = toScriptText(source);
    expect(text.length).toBe(source.length);
    expect(text.split('\n').length).toBe(source.split('\n').length);
    expect(text.indexOf('const x = 1;')).toBe(source.indexOf('const x = 1;'));
    expect(text).not.toContain('<p>');
  });

  it('ignores a <script> element inside the template', () => {
    // a JSON-LD payload rendered by the template is not the component script.
    const source =
      '<template><script type="application/ld+json">{"a": 1}</script></template>\n<script>let y = 2;</script>';
    const text = toScriptText(source);
    expect(text).not.toContain('"a"');
    expect(text).toContain('let y = 2;');
  });

  it('runs an unclosed script to the end of the file while it is being typed', () => {
    const source = '<template></template>\n<script>\nconst z';
    expect(toScriptText(source)).toContain('const z');
  });

  it('blanks a component with no script at all', () => {
    expect(toScriptText('<template><p>x</p></template>').trim()).toBe('');
  });
});

describe('module-resolution probe paths', () => {
  it('maps the typescript probe back to the component', () => {
    expect(isUtopiaFile('/a/Foo.utopia')).toBe(true);
    expect(isProbePath('/a/Foo.utopia.ts')).toBe(true);
    expect(fromProbePath('/a/Foo.utopia.ts')).toBe('/a/Foo.utopia');
  });
});
