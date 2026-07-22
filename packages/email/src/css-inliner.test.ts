import { describe, it, expect } from 'vitest';
import { inlineCSS } from './css-inliner';

describe('CSS Inliner', () => {
  it('returns html unchanged when css is empty', () => {
    const html = '<div class="app">Hello</div>';
    expect(inlineCSS(html, '')).toBe(html);
  });

  it('inlines a simple type selector', () => {
    const html = '<p>Hello</p>';
    const css = 'p { color: red; }';
    expect(inlineCSS(html, css)).toBe('<p style="color: red">Hello</p>');
  });

  it('inlines a class selector', () => {
    const html = '<div class="app">Hello</div>';
    const css = '.app { font-size: 14px; }';
    expect(inlineCSS(html, css)).toBe('<div class="app" style="font-size: 14px">Hello</div>');
  });

  it('inlines an ID selector', () => {
    const html = '<div id="main">Hello</div>';
    const css = '#main { margin: 0; }';
    expect(inlineCSS(html, css)).toBe('<div id="main" style="margin: 0">Hello</div>');
  });

  it('inlines attribute selectors', () => {
    const html = '<div data-u-abc="">Hello</div>';
    const css = '[data-u-abc] { color: blue; }';
    expect(inlineCSS(html, css)).toBe('<div data-u-abc="" style="color: blue">Hello</div>');
  });

  it('handles multiple rules on the same element', () => {
    const html = '<p class="text">Hello</p>';
    const css = 'p { color: red; } .text { font-size: 16px; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: red');
    expect(result).toContain('font-size: 16px');
  });

  it('respects specificity — class overrides type', () => {
    const html = '<p class="text">Hello</p>';
    const css = 'p { color: red; } .text { color: blue; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: blue');
    expect(result).not.toContain('color: red');
  });

  it('respects specificity — ID overrides class', () => {
    const html = '<p class="text" id="main">Hello</p>';
    const css = '.text { color: red; } #main { color: green; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: green');
  });

  it('preserves existing inline styles (highest priority)', () => {
    const html = '<p style="font-weight: bold">Hello</p>';
    const css = 'p { color: red; font-weight: normal; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: red');
    expect(result).toContain('font-weight: bold');
  });

  it('handles descendant selector', () => {
    const html = '<div class="wrapper"><p>Hello</p></div>';
    const css = '.wrapper p { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p style="color: red">');
  });

  it('handles child selector (>)', () => {
    const html = '<div class="parent"><p>Direct</p></div>';
    const css = '.parent > p { color: blue; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p style="color: blue">');
  });

  it('handles grouped selectors (comma-separated)', () => {
    const html = '<h1>Title</h1><p>Text</p>';
    const css = 'h1, p { margin: 0; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<h1 style="margin: 0">');
    expect(result).toContain('<p style="margin: 0">');
  });

  it('skips @media rules (not inlined)', () => {
    const html = '<p class="text">Hello</p>';
    const css = '.text { color: red; } @media (max-width: 600px) { .text { color: blue; } }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: red');
    // @media rule should NOT be inlined
    expect(result).not.toContain('color: blue');
  });

  it('handles multiple elements', () => {
    const html = '<div><p class="a">One</p><p class="b">Two</p></div>';
    const css = '.a { color: red; } .b { color: blue; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p class="a" style="color: red">');
    expect(result).toContain('<p class="b" style="color: blue">');
  });

  it('handles void elements', () => {
    const html = '<img src="test.png">';
    const css = 'img { border: 0; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('style="border: 0"');
  });

  it('strips CSS comments', () => {
    const html = '<p>Hello</p>';
    const css = '/* comment */ p { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: red');
  });

  it('source order wins when specificity is equal', () => {
    const html = '<p class="a b">Hello</p>';
    const css = '.a { color: red; } .b { color: blue; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('color: blue');
  });

  it('escapes double quotes in declaration values when writing the style attribute', () => {
    const html = '<div class="a">Hello</div>';
    const css = '.a { font-family: "Helvetica Neue", sans-serif; }';
    const result = inlineCSS(html, css);
    expect(result).toBe(
      '<div class="a" style="font-family: &quot;Helvetica Neue&quot;, sans-serif">Hello</div>',
    );
  });

  it('a quoted declaration value cannot break out of the style attribute', () => {
    const html = '<div class="a">Hello</div>';
    const css = '.a { font-family: x" onmouseover="alert(1) }';
    const result = inlineCSS(html, css);
    expect(result).not.toContain('" onmouseover="');
  });

  it('escapes quotes when replacing an existing style attribute', () => {
    const html = '<div class="a" style="color: red">Hello</div>';
    const css = '.a { font-family: "Arial" }';
    const result = inlineCSS(html, css);
    expect(result).toContain('style="font-family: &quot;Arial&quot;; color: red"');
  });

  it('matches attribute selectors with values', () => {
    const html = '<input type="text"><input type="hidden">';
    const css = 'input[type="text"] { border: 1px solid red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<input type="text" style="border: 1px solid red">');
    expect(result).toContain('<input type="hidden">');
  });

  it('skips pseudo-classes but still matches the base selector', () => {
    const html = '<a class="link">Go</a>';
    const css = '.link:hover { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('style="color: red"');
  });

  it('matches the universal selector', () => {
    const html = '<div><p>Hi</p></div>';
    const css = '* { box-sizing: border-box; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<div style="box-sizing: border-box">');
    expect(result).toContain('<p style="box-sizing: border-box">');
  });

  it('matches child combinator selectors', () => {
    const html = '<div class="outer"><p>Direct</p></div><p>Sibling</p>';
    const css = '.outer > p { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p style="color: red">Direct</p>');
    expect(result).toContain('<p>Sibling</p>');
  });

  it('does not match a child combinator when the element has no parent', () => {
    const html = '<p>Root</p>';
    const css = 'div > p { color: red; }';
    expect(inlineCSS(html, css)).toBe('<p>Root</p>');
  });

  it('matches descendant combinator selectors at any depth', () => {
    const html = '<div class="outer"><section><p>Deep</p></section></div>';
    const css = '.outer p { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p style="color: red">Deep</p>');
  });

  it('does not match a descendant selector without the ancestor', () => {
    const html = '<section><p>Hi</p></section>';
    const css = '.missing p { color: red; }';
    expect(inlineCSS(html, css)).toBe('<section><p>Hi</p></section>');
  });

  it('handles grouped selectors', () => {
    const html = '<h1>A</h1><h2>B</h2>';
    const css = 'h1, h2 { margin: 0; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<h1 style="margin: 0">A</h1>');
    expect(result).toContain('<h2 style="margin: 0">B</h2>');
  });

  it('returns html unchanged when css contains no parseable rules', () => {
    const html = '<p>Hello</p>';
    expect(inlineCSS(html, '/* only a comment */')).toBe(html);
    expect(inlineCSS(html, '@media print { p { color: red } }')).toBe(html);
  });

  it('does not apply styles to non-matching id selectors', () => {
    const html = '<div id="other">Hello</div>';
    const css = '#main { margin: 0; }';
    expect(inlineCSS(html, css)).toBe(html);
  });

  it('does not match a child combinator when the parent differs', () => {
    const html = '<div class="other"><p>Hi</p></div>';
    const css = '.outer > p { color: red; }';
    expect(inlineCSS(html, css)).toBe(html);
  });

  it('rejects selectors containing unsupported syntax', () => {
    const html = '<p>Hi</p>';
    const css = 'p%broken { color: red; }';
    expect(inlineCSS(html, css)).toBe(html);
  });

  it('skips declarations without a property or value', () => {
    const html = '<p class="a">Hi</p>';
    const css = '.a { : red; color: blue; broken }';
    const result = inlineCSS(html, css);
    expect(result).toBe('<p class="a" style="color: blue">Hi</p>');
  });

  it('leaves elements untouched when a rule has only empty declarations', () => {
    const html = '<p class="a">Hi</p>';
    const css = '.a { ;; }';
    expect(inlineCSS(html, css)).toBe(html);
  });

  it('tolerates stray closing tags', () => {
    const html = '</em><p class="a">Hi</p>';
    const css = '.a { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p class="a" style="color: red">');
  });

  it('tolerates a mismatched closing tag inside an open element', () => {
    const html = '<div class="outer"><p>Hi</p></em><p>Bye</p></div>';
    const css = '.outer p { color: red; }';
    const result = inlineCSS(html, css);
    expect(result).toContain('<p style="color: red">Hi</p>');
    expect(result).toContain('<p style="color: red">Bye</p>');
  });

  it('does not match attribute-existence selectors when the attribute is absent', () => {
    const html = '<div>Hello</div>';
    const css = '[data-missing] { color: red; }';
    expect(inlineCSS(html, css)).toBe(html);
  });

  it('rejects a bare colon pseudo-selector', () => {
    const html = '<p class="a">Hi</p>';
    const css = '.a: { color: red; }';
    expect(inlineCSS(html, css)).toBe(html);
  });

  it('rejects malformed id, class and attribute selectors', () => {
    const html = '<p id="x" class="y">Hi</p>';
    // id starting with a digit, class starting with a digit, unclosed attribute
    expect(inlineCSS(html, '#1bad { color: red; }')).toBe(html);
    expect(inlineCSS(html, '.2bad { color: red; }')).toBe(html);
    expect(inlineCSS(html, 'p[unclosed { color: red; }')).toBe(html);
  });

  it('tolerates malformed css edge cases', () => {
    const html = '<p class="a">Hi</p>';
    // trailing whitespace after the last rule
    expect(inlineCSS(html, '.a { color: red; }   ')).toContain('style="color: red"');
    // dangling selector without a block at EOF
    expect(inlineCSS(html, '.a { color: red } .b')).toContain('style="color: red"');
    // empty declaration block
    expect(inlineCSS(html, '.a { }')).toBe(html);
    // empty selector
    expect(inlineCSS(html, '{ color: red }')).toBe(html);
    // trailing comma in a selector group
    expect(inlineCSS(html, '.a, { color: red }')).toContain('style="color: red"');
    // unterminated at-rule
    expect(inlineCSS(html, '@media print')).toBe(html);
  });

  it('matches attribute-existence selectors for valueless attributes', () => {
    const html = '<div hidden>Hi</div>';
    const css = '[hidden] { color: red; }';
    expect(inlineCSS(html, css)).toBe('<div hidden style="color: red">Hi</div>');
  });

  it('handles self-closing (XHTML-style) tags', () => {
    const html = '<img src="a.png" />';
    const css = 'img { border: 0; }';
    expect(inlineCSS(html, css)).toBe('<img src="a.png"  style="border: 0"/>');
  });
});
