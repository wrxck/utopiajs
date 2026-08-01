// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { splitBlocks } from './split-blocks';

describe('splitBlocks', () => {
  it('returns an empty root for empty input', () => {
    const root = splitBlocks('');
    expect(root).toEqual({ type: 'root', blocks: [], start: 0, end: 0 });
  });

  it('extracts a single block with offsets', () => {
    const source = '<template><p>hi</p></template>';
    const root = splitBlocks(source);
    expect(root.blocks).toHaveLength(1);
    expect(root.blocks[0]).toMatchObject({
      type: 'block',
      name: 'template',
      rawAttrs: '',
      content: '<p>hi</p>',
      start: 0,
      end: source.length,
    });
  });

  it('keeps attributes raw and trimmed', () => {
    const root = splitBlocks('<style   lang="scss"  scoped>.a{}</style>');
    expect(root.blocks[0].rawAttrs).toBe('lang="scss"  scoped');
  });

  it('handles a nested native <template> element without truncating the block', () => {
    const source =
      '<template><div><template>inner</template></div></template>\n<script>const a = 1;</script>';
    const root = splitBlocks(source);
    const template = root.blocks.find((b) => b.name === 'template');
    expect(template).toBeDefined();
    // The block must span to the OUTER closing tag, not the inner one.
    expect(template!.content).toBe('<div><template>inner</template></div>');
    expect(root.blocks.map((b) => b.name)).toEqual(['template', 'script']);
  });

  it('does not emit overlapping blocks for tags appearing inside another block', () => {
    // A <style> tag mentioned inside the template body must not become its
    // own top-level block (that would duplicate content when printing).
    const source = '<template><pre>&lt;x&gt;<style>.fake{}</style></pre></template>';
    const root = splitBlocks(source);
    expect(root.blocks).toHaveLength(1);
    expect(root.blocks[0].name).toBe('template');
    expect(root.blocks[0].content).toBe('<pre>&lt;x&gt;<style>.fake{}</style></pre>');
  });

  it('ignores an unclosed block', () => {
    const root = splitBlocks('<template><p>hi</p>');
    expect(root.blocks).toHaveLength(0);
  });

  it('returns blocks in source order', () => {
    const root = splitBlocks(
      '<style>.a{}</style><script>1</script><template><i/></template><test>2</test>',
    );
    expect(root.blocks.map((b) => b.name)).toEqual(['style', 'script', 'template', 'test']);
  });
});
