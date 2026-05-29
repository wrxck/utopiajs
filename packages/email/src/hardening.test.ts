// regression tests for the v0.8 email hardening pass: css-inliner redos and
// mailer header (crlf) injection.

import { describe, it, expect } from 'vitest';
import { renderToString } from '@matthesketh/utopia-server';

import { inlineCSS } from './css-inliner';
import { createMailer } from './mailer';
import { EmailButton } from './components/email-button';
import { EmailImage } from './components/email-image';
import type { EmailAdapter, EmailMessage } from './types';

describe('email components drop dangerous URL schemes', () => {
  it('strips javascript: from an EmailButton href', () => {
    const { html } = renderToString(EmailButton as never, {
      href: 'javascript:alert(1)',
      text: 'x',
    });
    expect(html).not.toContain('javascript:');
  });

  it('strips javascript: from an EmailImage src', () => {
    const { html } = renderToString(EmailImage as never, { src: 'javascript:alert(1)', alt: 'x' });
    expect(html).not.toContain('javascript:');
  });
});

describe('css-inliner is not vulnerable to whitespace ReDoS', () => {
  it('processes a tag with a huge attribute whitespace run quickly', () => {
    const html = `<div style="${' '.repeat(50_000)}">x</div>`;
    const start = Date.now();
    inlineCSS(html, 'div { color: red }');
    const elapsed = Date.now() - start;
    // pre-fix this backtracked for multiple seconds; assert a generous bound.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('mailer rejects header (CRLF) injection', () => {
  function noopAdapter(): EmailAdapter & { sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
      name: 'noop',
      sent,
      async send(message: EmailMessage) {
        sent.push(message);
        return { id: '1', success: true };
      },
    } as EmailAdapter & { sent: EmailMessage[] };
  }

  const component = { setup: () => ({}), render: () => '<p>hi</p>' } as never;

  it('throws when the subject contains CRLF', async () => {
    const adapter = noopAdapter();
    const mailer = createMailer(adapter);
    await expect(
      mailer.send({
        to: 'a@b.test',
        from: 'no-reply@b.test',
        subject: 'Hi\r\nBcc: victim@evil.test',
        component,
      }),
    ).rejects.toThrow(/injection/i);
    expect(adapter.sent.length).toBe(0);
  });

  it('throws when a recipient contains CRLF', async () => {
    const adapter = noopAdapter();
    const mailer = createMailer(adapter);
    await expect(
      mailer.send({
        to: ['a@b.test', 'c@d.test\r\nBcc: victim@evil.test'],
        from: 'no-reply@b.test',
        subject: 'ok',
        component,
      }),
    ).rejects.toThrow(/injection/i);
  });
});
