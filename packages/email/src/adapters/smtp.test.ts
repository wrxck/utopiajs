// ============================================================================
// @matthesketh/utopia-email — SMTP adapter tests (nodemailer fully mocked)
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailMessage } from '../types';
import { smtpAdapter } from './smtp';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  createTransport: mocks.createTransport,
  default: { createTransport: mocks.createTransport },
}));

const baseMessage: EmailMessage = {
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
};

const config = { host: 'smtp.example.com', port: 587 };

beforeEach(() => {
  mocks.sendMail.mockReset().mockResolvedValue({ messageId: '<msg-1@example.com>' });
  mocks.createTransport.mockReset().mockReturnValue({ sendMail: mocks.sendMail });
});

describe('smtpAdapter', () => {
  it('creates a transport from the config and sends the message', async () => {
    const adapter = smtpAdapter({ ...config, auth: { user: 'u', pass: 'p' } });
    const result = await adapter.send(baseMessage);

    expect(result).toEqual({ success: true, messageId: '<msg-1@example.com>' });
    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@example.com',
        to: 'user@example.com',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
        cc: undefined,
        bcc: undefined,
      }),
    );
  });

  it('defaults secure to true for port 465', async () => {
    await smtpAdapter({ host: 'h', port: 465 }).send(baseMessage);
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it('honours an explicit secure flag over the port heuristic', async () => {
    await smtpAdapter({ host: 'h', port: 465, secure: false }).send(baseMessage);
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false }));
  });

  it('joins recipient arrays with commas', async () => {
    await smtpAdapter(config).send({
      ...baseMessage,
      to: ['a@x.com', 'b@x.com'],
      cc: ['c@x.com', 'd@x.com'],
      bcc: 'e@x.com',
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@x.com, b@x.com',
        cc: 'c@x.com, d@x.com',
        bcc: 'e@x.com',
      }),
    );
  });

  it('passes scalar cc and array bcc through correctly', async () => {
    await smtpAdapter(config).send({
      ...baseMessage,
      cc: 'c@x.com',
      bcc: ['e@x.com', 'f@x.com'],
      replyTo: 'reply@x.com',
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: 'c@x.com',
        bcc: 'e@x.com, f@x.com',
        replyTo: 'reply@x.com',
      }),
    );
  });

  it('maps attachments', async () => {
    await smtpAdapter(config).send({
      ...baseMessage,
      attachments: [
        { filename: 'a.txt', content: 'hello', contentType: 'text/plain', encoding: 'utf8' },
      ],
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { filename: 'a.txt', content: 'hello', contentType: 'text/plain', encoding: 'utf8' },
        ],
      }),
    );
  });

  it('reuses the transporter across sends', async () => {
    const adapter = smtpAdapter(config);
    await adapter.send(baseMessage);
    await adapter.send(baseMessage);
    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
  });

  it('creates only one transporter for concurrent sends', async () => {
    const adapter = smtpAdapter(config);
    const results = await Promise.all([adapter.send(baseMessage), adapter.send(baseMessage)]);
    // Both sends must share a single lazily-created transporter — without
    // in-flight deduplication the second send constructs a second transport.
    expect(results).toEqual([
      { success: true, messageId: '<msg-1@example.com>' },
      { success: true, messageId: '<msg-1@example.com>' },
    ]);
    expect(mocks.createTransport).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it('returns a failure result when sendMail rejects', async () => {
    mocks.sendMail.mockRejectedValue(new Error('connection refused'));
    const result = await smtpAdapter(config).send(baseMessage);
    expect(result).toEqual({ success: false, error: 'connection refused' });
  });

  it('stringifies non-Error rejection values', async () => {
    mocks.sendMail.mockRejectedValue('wat');
    const result = await smtpAdapter(config).send(baseMessage);
    expect(result).toEqual({ success: false, error: 'wat' });
  });

  it('reports a helpful error when nodemailer is not installed', async () => {
    vi.resetModules();
    vi.doMock('nodemailer', () => {
      throw new Error('Cannot find module "nodemailer"');
    });
    try {
      const { smtpAdapter: freshAdapter } = await import('./smtp');
      const result = await freshAdapter(config).send(baseMessage);
      expect(result.success).toBe(false);
      expect(result.error).toContain('"nodemailer" package is required');
    } finally {
      vi.doUnmock('nodemailer');
      vi.resetModules();
    }
  });
});
