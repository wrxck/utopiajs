// ============================================================================
// a11y.test.ts — Tests for compile-time accessibility checking
// ============================================================================

import { describe, it, expect } from 'vitest';
import { parseTemplate } from './template-compiler';
import { checkA11y } from './a11y';
import { compile } from './index';

// Helper: parse and check in one call.
function check(template: string, options?: { disable?: string[] }) {
  const ast = parseTemplate(template);
  return checkA11y(ast, options);
}

// ---------------------------------------------------------------------------
// img-alt
// ---------------------------------------------------------------------------

describe('img-alt', () => {
  it('warns on <img> without alt', () => {
    const w = check('<img src="photo.jpg">');
    expect(w).toHaveLength(1);
    expect(w[0].rule).toBe('img-alt');
  });

  it('passes with static alt', () => {
    expect(check('<img src="photo.jpg" alt="A photo">')).toHaveLength(0);
  });

  it('passes with bound :alt', () => {
    expect(check('<img src="photo.jpg" :alt="desc">')).toHaveLength(0);
  });

  it('passes with aria-label', () => {
    expect(check('<img src="photo.jpg" aria-label="Photo">')).toHaveLength(0);
  });

  it('passes with role="presentation" (decorative)', () => {
    expect(check('<img src="bg.jpg" role="presentation">')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// click-keyboard
// ---------------------------------------------------------------------------

describe('click-keyboard', () => {
  it('warns on non-interactive element with @click but no keyboard handler', () => {
    const w = check('<div @click="doThing">click me</div>');
    expect(w.some((w) => w.rule === 'click-keyboard')).toBe(true);
  });

  it('does not warn on <button> with @click', () => {
    const w = check('<button @click="doThing">click me</button>');
    expect(w.filter((w) => w.rule === 'click-keyboard')).toHaveLength(0);
  });

  it('does not warn on <a> with @click', () => {
    const w = check('<a href="/foo" @click="doThing">link</a>');
    expect(w.filter((w) => w.rule === 'click-keyboard')).toHaveLength(0);
  });

  it('does not warn when @keydown is present', () => {
    const w = check('<div @click="go" @keydown="go" tabindex="0">go</div>');
    expect(w.filter((w) => w.rule === 'click-keyboard')).toHaveLength(0);
  });

  it('warns about missing tabindex on non-interactive element', () => {
    const w = check('<div @click="go" @keydown="go">go</div>');
    expect(w.some((w) => w.message.includes('tabindex'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// anchor-content
// ---------------------------------------------------------------------------

describe('anchor-content', () => {
  it('warns on empty <a>', () => {
    const w = check('<a href="/foo"></a>');
    expect(w.some((w) => w.rule === 'anchor-content')).toBe(true);
  });

  it('passes with text content', () => {
    const w = check('<a href="/foo">Home</a>');
    expect(w.filter((w) => w.rule === 'anchor-content')).toHaveLength(0);
  });

  it('passes with aria-label', () => {
    const w = check('<a href="/foo" aria-label="Home"></a>');
    expect(w.filter((w) => w.rule === 'anchor-content')).toHaveLength(0);
  });

  it('passes with child elements', () => {
    const w = check('<a href="/foo"><img src="icon.svg" alt="Home"></a>');
    expect(w.filter((w) => w.rule === 'anchor-content')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// form-label
// ---------------------------------------------------------------------------

describe('form-label', () => {
  it('warns on <input> without id or aria-label', () => {
    const w = check('<input type="text">');
    expect(w.some((w) => w.rule === 'form-label')).toBe(true);
  });

  it('passes with id', () => {
    const w = check('<input type="text" id="name">');
    expect(w.filter((w) => w.rule === 'form-label')).toHaveLength(0);
  });

  it('passes with aria-label', () => {
    const w = check('<input type="text" aria-label="Name">');
    expect(w.filter((w) => w.rule === 'form-label')).toHaveLength(0);
  });

  it('does not warn on hidden inputs', () => {
    const w = check('<input type="hidden" name="csrf">');
    expect(w.filter((w) => w.rule === 'form-label')).toHaveLength(0);
  });

  it('warns on <select> without label', () => {
    const w = check('<select><option>A</option></select>');
    expect(w.some((w) => w.rule === 'form-label')).toBe(true);
  });

  it('warns on <textarea> without label', () => {
    const w = check('<textarea></textarea>');
    expect(w.some((w) => w.rule === 'form-label')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// no-distracting
// ---------------------------------------------------------------------------

describe('no-distracting', () => {
  it('warns on <marquee>', () => {
    const w = check('<marquee>scrolling text</marquee>');
    expect(w).toHaveLength(1);
    expect(w[0].rule).toBe('no-distracting');
  });

  it('warns on <blink>', () => {
    const w = check('<blink>blinking text</blink>');
    expect(w).toHaveLength(1);
    expect(w[0].rule).toBe('no-distracting');
  });
});

// ---------------------------------------------------------------------------
// heading-order
// ---------------------------------------------------------------------------

describe('heading-order', () => {
  it('warns when heading level is skipped', () => {
    const w = check('<div><h1>Title</h1><h3>Subtitle</h3></div>');
    expect(w.some((w) => w.rule === 'heading-order')).toBe(true);
  });

  it('does not warn on sequential headings', () => {
    const w = check('<div><h1>Title</h1><h2>Subtitle</h2></div>');
    expect(w.filter((w) => w.rule === 'heading-order')).toHaveLength(0);
  });

  it('does not warn on same-level headings', () => {
    const w = check('<div><h2>A</h2><h2>B</h2></div>');
    expect(w.filter((w) => w.rule === 'heading-order')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// aria-role
// ---------------------------------------------------------------------------

describe('aria-role', () => {
  it('warns on invalid role', () => {
    const w = check('<div role="foobar">content</div>');
    expect(w).toHaveLength(1);
    expect(w[0].rule).toBe('aria-role');
    expect(w[0].message).toContain('foobar');
  });

  it('passes on valid role', () => {
    const w = check('<div role="button">content</div>');
    expect(w.filter((w) => w.rule === 'aria-role')).toHaveLength(0);
  });

  it('passes on role="navigation"', () => {
    const w = check('<nav role="navigation">nav</nav>');
    expect(w.filter((w) => w.rule === 'aria-role')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-positive-tabindex
// ---------------------------------------------------------------------------

describe('no-positive-tabindex', () => {
  it('warns on positive tabindex', () => {
    const w = check('<div tabindex="5">content</div>');
    expect(w.some((w) => w.rule === 'no-positive-tabindex')).toBe(true);
  });

  it('does not warn on tabindex="0"', () => {
    const w = check('<div tabindex="0">content</div>');
    expect(w.filter((w) => w.rule === 'no-positive-tabindex')).toHaveLength(0);
  });

  it('does not warn on tabindex="-1"', () => {
    const w = check('<div tabindex="-1">content</div>');
    expect(w.filter((w) => w.rule === 'no-positive-tabindex')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// media-captions
// ---------------------------------------------------------------------------

describe('media-captions', () => {
  it('warns on <video> without <track>', () => {
    const w = check('<video src="movie.mp4"></video>');
    expect(w.some((w) => w.rule === 'media-captions')).toBe(true);
  });

  it('passes with <track> child', () => {
    const w = check('<video src="movie.mp4"><track kind="captions" src="subs.vtt"></video>');
    expect(w.filter((w) => w.rule === 'media-captions')).toHaveLength(0);
  });

  it('passes with aria-label', () => {
    const w = check('<video src="movie.mp4" aria-label="Movie clip"></video>');
    expect(w.filter((w) => w.rule === 'media-captions')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// anchor-valid
// ---------------------------------------------------------------------------

describe('anchor-valid', () => {
  it('warns on <a> without href', () => {
    const w = check('<a>click</a>');
    expect(w.some((w) => w.rule === 'anchor-valid')).toBe(true);
  });

  it('passes with href', () => {
    const w = check('<a href="/page">click</a>');
    expect(w.filter((w) => w.rule === 'anchor-valid')).toHaveLength(0);
  });

  it('passes with bound :href', () => {
    const w = check('<a :href="url">click</a>');
    expect(w.filter((w) => w.rule === 'anchor-valid')).toHaveLength(0);
  });

  it('passes with role="button"', () => {
    const w = check('<a role="button" @click="go">click</a>');
    expect(w.filter((w) => w.rule === 'anchor-valid')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Options: disabling rules
// ---------------------------------------------------------------------------

describe('options', () => {
  it('can disable specific rules', () => {
    const w = check('<img src="photo.jpg">', { disable: ['img-alt'] });
    expect(w).toHaveLength(0);
  });

  it('can disable multiple rules', () => {
    const w = check('<img src="photo.jpg"><marquee>hi</marquee>', {
      disable: ['img-alt', 'no-distracting'],
    });
    expect(w).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: compile() includes a11y warnings
// ---------------------------------------------------------------------------

describe('compile() a11y integration', () => {
  it('includes a11y warnings in compile result', () => {
    const result = compile('<template><img src="photo.jpg"></template>');
    expect(result.a11y).toHaveLength(1);
    expect(result.a11y[0].rule).toBe('img-alt');
  });

  it('returns empty a11y array for accessible templates', () => {
    const result = compile('<template><img src="photo.jpg" alt="A photo"></template>');
    expect(result.a11y).toHaveLength(0);
  });

  it('can disable a11y checking via options', () => {
    const result = compile('<template><img src="photo.jpg"></template>', {
      a11y: false,
    });
    expect(result.a11y).toHaveLength(0);
  });
});
