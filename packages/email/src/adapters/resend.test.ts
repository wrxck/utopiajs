// ============================================================================
// @matthesketh/utopia-email — Resend adapter tests (resend SDK fully mocked)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resendAdapter } from './resend';
import type { EmailMessage } from '../types';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  constructedWith: [] as string[],
}));

vi.mock('resend', () => {
  class Resend {
    emails = { send: mocks.send };
    constructor(apiKey: string) {
      mocks.constructedWith.push(apiKey);
    }
  }
  return { Resend };
});

const baseMessage: EmailMessage = {
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
};

beforeEach(() => {
  mocks.constructedWith.length = 0;
  mocks.send.mockReset().mockResolvedValue({ data: { id: 'resend-1' }, error: null });
});

describe('resendAdapter', () => {
  it('constructs the client with the API key and sends the message', async () => {
    const adapter = resendAdapter({ apiKey: 'rk_test' });
    const result = await adapter.send(baseMessage);

    expect(result).toEqual({ success: true, messageId: 'resend-1' });
    expect(mocks.constructedWith).toEqual(['rk_test']);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@example.com',
        to: ['user@example.com'],
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    );
  });

  it('wraps scalar cc/bcc into arrays and forwards replyTo as reply_to', async () => {
    await resendAdapter({ apiKey: 'k' }).send({
      ...baseMessage,
      to: ['a@x.com', 'b@x.com'],
      cc: 'c@x.com',
      bcc: ['d@x.com'],
      replyTo: 'reply@x.com',
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['a@x.com', 'b@x.com'],
        cc: ['c@x.com'],
        bcc: ['d@x.com'],
        reply_to: 'reply@x.com',
      }),
    );
  });

  it('passes cc/bcc arrays through and wraps scalar bcc', async () => {
    await resendAdapter({ apiKey: 'k' }).send({
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
    const result = await resendAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('maps attachment contentType to content_type', async () => {
    await resendAdapter({ apiKey: 'k' }).send({
      ...baseMessage,
      attachments: [{ filename: 'a.pdf', content: 'YWJj', contentType: 'application/pdf' }],
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'a.pdf', content: 'YWJj', content_type: 'application/pdf' }],
      }),
    );
  });

  it('reports failure when the API returns an error object instead of throwing', async () => {
    // resend v3+ does not throw on API errors — it resolves { data: null, error }.
    mocks.send.mockResolvedValue({
      data: null,
      error: { message: 'Invalid `from` address', name: 'validation_error' },
    });
    const result = await resendAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid `from` address');
    expect(result.messageId).toBeUndefined();
  });

  it('reports failure when the client throws', async () => {
    mocks.send.mockRejectedValue(new Error('network down'));
    const result = await resendAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result).toEqual({ success: false, error: 'network down' });
  });

  it('creates only one client for concurrent sends', async () => {
    const adapter = resendAdapter({ apiKey: 'k' });
    const results = await Promise.all([adapter.send(baseMessage), adapter.send(baseMessage)]);
    // Both sends must share a single lazily-created client — without in-flight
    // deduplication the second send constructs a second client.
    expect(results).toEqual([
      { success: true, messageId: 'resend-1' },
      { success: true, messageId: 'resend-1' },
    ]);
    expect(mocks.constructedWith).toHaveLength(1);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('stringifies API error objects that have no message', async () => {
    mocks.send.mockResolvedValue({ data: null, error: {} });
    const result = await resendAdapter({ apiKey: 'k' }).send(baseMessage);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('reports a helpful error when resend is not installed', async () => {
    vi.resetModules();
    vi.doMock('resend', () => {
      throw new Error('Cannot find module "resend"');
    });
    try {
      const { resendAdapter: freshAdapter } = await import('./resend');
      const result = await freshAdapter({ apiKey: 'k' }).send(baseMessage);
      expect(result.success).toBe(false);
      expect(result.error).toContain('"resend" package is required');
    } finally {
      vi.doUnmock('resend');
      vi.resetModules();
    }
  });
});
