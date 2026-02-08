import { describe, it, expect } from 'vitest';
import { inlineCSS } from './css-inliner.js';

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
});
