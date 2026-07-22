import { describe, it, expect } from 'vitest';
import { htmlToText } from './html-to-text';

describe('HTML to Text', () => {
  it('strips HTML tags', () => {
    expect(htmlToText('<p>Hello</p>')).toBe('Hello');
  });

  it('strips <style> blocks', () => {
    expect(htmlToText('<style>.foo { color: red; }</style><p>Hello</p>')).toBe('Hello');
  });

  it('strips <head> blocks', () => {
    expect(htmlToText('<head><title>Test</title></head><body>Hello</body>')).toBe('Hello');
  });

  it('strips HTML comments', () => {
    expect(htmlToText('<!-- comment --><p>Hello</p>')).toBe('Hello');
  });

  it('converts links to text (url) format', () => {
    expect(htmlToText('<a href="https://example.com">Click here</a>')).toBe(
      'Click here (https://example.com)',
    );
  });

  it('converts links where text equals href', () => {
    expect(htmlToText('<a href="https://example.com">https://example.com</a>')).toBe(
      'https://example.com',
    );
  });

  it('falls back to the href when a link has no text content', () => {
    expect(htmlToText('<a href="https://example.com"><img src="i.png"></a>')).toBe(
      'https://example.com',
    );
  });

  it('converts headings to uppercase', () => {
    expect(htmlToText('<h1>My Title</h1>')).toBe('MY TITLE');
  });

  it('converts <br> to newlines', () => {
    expect(htmlToText('Hello<br>World')).toBe('Hello\nWorld');
    expect(htmlToText('Hello<br/>World')).toBe('Hello\nWorld');
    expect(htmlToText('Hello<br />World')).toBe('Hello\nWorld');
  });

  it('converts <hr> to divider', () => {
    const result = htmlToText('Above<hr>Below');
    expect(result).toContain('---');
  });

  it('converts list items', () => {
    const result = htmlToText('<ul><li>One</li><li>Two</li><li>Three</li></ul>');
    expect(result).toContain('- One');
    expect(result).toContain('- Two');
    expect(result).toContain('- Three');
  });

  it('adds newlines after block elements', () => {
    const result = htmlToText('<p>First</p><p>Second</p>');
    expect(result).toContain('First');
    expect(result).toContain('Second');
    // Should have separation between paragraphs
    expect(result).toMatch(/First\n+Second/);
  });

  it('decodes HTML entities', () => {
    expect(htmlToText('&amp; &lt; &gt; &quot;')).toBe('& < > "');
  });

  it('decodes numeric entities', () => {
    expect(htmlToText('&#169;')).toBe('\u00A9');
  });

  it('decodes hex entities', () => {
    expect(htmlToText('&#x2022;')).toBe('\u2022');
  });

  it('decodes &nbsp;', () => {
    expect(htmlToText('Hello&nbsp;World')).toBe('Hello World');
  });

  it('collapses excessive whitespace', () => {
    expect(htmlToText('<p>  Hello    World  </p>')).toBe('Hello World');
  });

  it('collapses excessive newlines', () => {
    const result = htmlToText('<p>A</p><p></p><p></p><p>B</p>');
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('handles a full email-like document', () => {
    const html = `
      <head><title>Test</title></head>
      <style>body { color: black; }</style>
      <h1>Welcome</h1>
      <p>Hello <strong>World</strong></p>
      <a href="https://example.com">Click here</a>
      <hr>
      <p>Footer</p>
    `;
    const result = htmlToText(html);
    expect(result).toContain('WELCOME');
    expect(result).toContain('Hello World');
    expect(result).toContain('Click here (https://example.com)');
    expect(result).toContain('---');
    expect(result).toContain('Footer');
  });

  it('decodes named entities', () => {
    expect(htmlToText('<p>A &amp; B &copy; &hellip;</p>')).toBe('A & B © …');
  });

  it('decodes numeric decimal entities', () => {
    expect(htmlToText('<p>&#65;&#66;</p>')).toBe('AB');
  });

  it('decodes numeric hex entities', () => {
    expect(htmlToText('<p>&#x41;&#x42;</p>')).toBe('AB');
  });

  it('decodes astral-plane numeric entities (above U+FFFF)', () => {
    // 128169 is U+1F4A9; String.fromCharCode truncates it to a lone surrogate.
    expect(htmlToText('<p>&#128169;</p>')).toBe('\u{1F4A9}');
    expect(htmlToText('<p>&#x1F4A9;</p>')).toBe('\u{1F4A9}');
  });

  it('leaves invalid numeric entities untouched', () => {
    // Above the Unicode range — decoding would throw in fromCodePoint.
    expect(htmlToText('<p>&#1114112;</p>')).toBe('&#1114112;');
  });

  it('leaves unknown named entities untouched', () => {
    expect(htmlToText('<p>&unknownentity;</p>')).toBe('&unknownentity;');
  });
});
