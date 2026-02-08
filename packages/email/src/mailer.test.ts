import { describe, it, expect, vi } from 'vitest';
import { createMailer } from './mailer.js';
import {
  createElement,
  createTextNode,
  appendChild,
  setAttr,
} from '@utopia/server/ssr-runtime';
import type { EmailAdapter, EmailMessage, EmailResult } from './types.js';

// Simple test component
const TestComponent = {
  setup: (props: any) => ({ name: props.name ?? 'User' }),
  render: (ctx: any) => {
    const div = createElement('div');
    setAttr(div, 'class', 'email-body');
    const p = createElement('p');
    appendChild(p, createTextNode(`Hello ${ctx.name}!`));
    appendChild(div, p);
    return div;
  },
};

// Mock adapter
function createMockAdapter(): EmailAdapter & { lastMessage: EmailMessage | null; sendFn: ReturnType<typeof vi.fn> } {
  const sendFn = vi.fn<[EmailMessage], Promise<EmailResult>>().mockResolvedValue({
    success: true,
    messageId: 'test-123',
  });

  return {
    lastMessage: null,
    sendFn,
    async send(message: EmailMessage): Promise<EmailResult> {
      (this as any).lastMessage = message;
      return sendFn(message);
    },
  };
}

describe('createMailer', () => {
  it('renders component and sends via adapter', async () => {
    const adapter = createMockAdapter();
    const mailer = createMailer(adapter);

    const result = await mailer.send({
      to: 'alice@example.com',
      from: 'noreply@example.com',
      subject: 'Welcome!',
      component: TestComponent,
      props: { name: 'Alice' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('test-123');
    expect(adapter.sendFn).toHaveBeenCalledOnce();

    const sent = adapter.lastMessage!;
    expect(sent.to).toBe('alice@example.com');
    expect(sent.from).toBe('noreply@example.com');
    expect(sent.subject).toBe('Welcome!');
    expect(sent.html).toContain('Hello Alice!');
    expect(sent.html).toContain('<!DOCTYPE html');
    expect(sent.text).toContain('Hello Alice!');
  });

  it('passes cc, bcc, replyTo, and attachments', async () => {
    const adapter = createMockAdapter();
    const mailer = createMailer(adapter);

    await mailer.send({
      to: 'alice@example.com',
      from: 'noreply@example.com',
      subject: 'Test',
      component: TestComponent,
      cc: 'bob@example.com',
      bcc: ['secret@example.com'],
      replyTo: 'support@example.com',
      attachments: [
        { filename: 'doc.pdf', content: 'base64data', contentType: 'application/pdf' },
      ],
    });

    const sent = adapter.lastMessage!;
    expect(sent.cc).toBe('bob@example.com');
    expect(sent.bcc).toEqual(['secret@example.com']);
    expect(sent.replyTo).toBe('support@example.com');
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments![0].filename).toBe('doc.pdf');
  });

  it('passes renderOptions to renderEmail', async () => {
    const adapter = createMockAdapter();
    const mailer = createMailer(adapter);

    await mailer.send({
      to: 'alice@example.com',
      from: 'noreply@example.com',
      subject: 'Preview',
      component: TestComponent,
      renderOptions: {
        previewText: 'Check this out!',
      },
    });

    const sent = adapter.lastMessage!;
    expect(sent.html).toContain('Check this out!');
  });

  it('handles adapter failure', async () => {
    const adapter: EmailAdapter = {
      async send(): Promise<EmailResult> {
        return { success: false, error: 'Connection refused' };
      },
    };
    const mailer = createMailer(adapter);

    const result = await mailer.send({
      to: 'alice@example.com',
      from: 'noreply@example.com',
      subject: 'Test',
      component: TestComponent,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });

  it('uses empty subject when none provided', async () => {
    const adapter = createMockAdapter();
    const mailer = createMailer(adapter);

    await mailer.send({
      to: 'alice@example.com',
      from: 'noreply@example.com',
      component: TestComponent,
    });

    const sent = adapter.lastMessage!;
    expect(sent.subject).toBe('');
  });
});
