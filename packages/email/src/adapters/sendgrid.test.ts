// ============================================================================
// @matthesketh/utopia-email — SendGrid adapter tests (@sendgrid/mail mocked)
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailMessage } from '../types';
import { sendgridAdapter } from './sendgrid';

const mocks = vi.hoisted(() => ({
  setApiKey: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: mocks.setApiKey, send: mocks.send },
}));

const baseMessage: EmailMessage = {
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
};

beforeEach(() => {
  mocks.setApiKey.mockReset();
  mocks.send
    .mockReset()
    .mockResolvedValue([{ statusCode: 202, headers: { 'x-message-id': 'sg-1' } }, {}]);
});

describe('sendgridAdapter', () => {
  it('sets the API key and sends the message', async () => {
    const adapter = sendgridAdapter({ apiKey: 'SG.test' });
    const result = await adapter.send(baseMessage);

    expect(result).toEqual({ success: true, messageId: 'sg-1' });
    expect(mocks.setApiKey).toHaveBeenCalledWith('SG.test');
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['user@example.com'],
        from: 'noreply@example.com',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    );
    // Optional fields are omitted entirely when absent.
    const payload = mocks.send.mock.calls[0][0] as Record<string, unknown>;
    expect('cc' in payload).toBe(false);
    expect('bcc' in payload).toBe(false);
    expect('replyTo' in payload).toBe(false);
    expect('attachments' in payload).toBe(false);
  });

  it('wraps scalar cc/bcc into arrays and forwards replyTo and headers', async () => {
    await sendgridAdapter({ apiKey: 'k' }).send({
      ...baseMessage,
      to: ['a@x.com'],
      cc: 'c@x.com',
      bcc: ['d@x.com', 'e@x.com'],
      replyTo: 'reply@x.com',
      headers: { 'X-Campaign': 'welcome' },
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['a@x.com'],
        cc: ['c@x.com'],
        bcc: ['d@x.com', 'e@x.com'],
        replyTo: 'reply@x.com',
        headers: { 'X-Campaign': 'welcome' },
      }),
    );
  });

  it('passes cc arrays through and wraps scalar bcc', async () => {
    await sendgridAdapter({ apiKey: 'k' }).send({
      ...baseMessage,
      cc: ['c1@x.com', 'c2@x.com'],
      bcc: 'd@x.com',
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ['c1@x.com', 'c2@x.com'],
        bcc: ['d@x.com'],
      }),
    );
  });

  it('stringifies non-Error rejection values', async () => {
    mocks.send.mockRejectedValue('boom');
    const result = await sendgridAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('base64-encodes Buffer attachments and passes string content through', async () => {
    await sendgridAdapter({ apiKey: 'k' }).send({
      ...baseMessage,
      attachments: [
        { filename: 'bin.dat', content: Buffer.from('abc'), contentType: 'application/rand' },
        { filename: 'plain.txt', content: 'already-encoded' },
      ],
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: 'bin.dat',
            content: Buffer.from('abc').toString('base64'),
            type: 'application/rand',
            disposition: 'attachment',
          },
          {
            filename: 'plain.txt',
            content: 'already-encoded',
            type: undefined,
            disposition: 'attachment',
          },
        ],
      }),
    );
  });

  it('returns success without a messageId when the header is missing', async () => {
    mocks.send.mockResolvedValue([{ statusCode: 202, headers: {} }, {}]);
    const result = await sendgridAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result).toEqual({ success: true, messageId: undefined });
  });

  it('returns a failure result when send rejects', async () => {
    mocks.send.mockRejectedValue(new Error('unauthorized'));
    const result = await sendgridAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result).toEqual({ success: false, error: 'unauthorized' });
  });

  it('initialises the client only once across concurrent sends', async () => {
    const adapter = sendgridAdapter({ apiKey: 'k' });
    const results = await Promise.all([adapter.send(baseMessage), adapter.send(baseMessage)]);
    await adapter.send(baseMessage);
    // All sends must share a single lazily-initialised client — without
    // in-flight deduplication the second concurrent send initialises again.
    expect(results.every((r) => r.success)).toBe(true);
    expect(mocks.setApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it('handles an empty response tuple without crashing', async () => {
    mocks.send.mockResolvedValue([]);
    const result = await sendgridAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result).toEqual({ success: true, messageId: undefined });
  });

  it('reports a helpful error when @sendgrid/mail is not installed', async () => {
    vi.resetModules();
    vi.doMock('@sendgrid/mail', () => {
      throw new Error('Cannot find module "@sendgrid/mail"');
    });
    try {
      const { sendgridAdapter: freshAdapter } = await import('./sendgrid');
      const result = await freshAdapter({ apiKey: 'k' }).send(baseMessage);
      expect(result.success).toBe(false);
      expect(result.error).toContain('"@sendgrid/mail" package is required');
    } finally {
      vi.doUnmock('@sendgrid/mail');
      vi.resetModules();
    }
  });
});
