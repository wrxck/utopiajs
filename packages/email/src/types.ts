// ============================================================================
// @matthesketh/utopia-email — Shared types
// ============================================================================

export interface RenderEmailOptions {
  /** Email subject line (can also be set in MailerSendOptions). */
  subject?: string;
  /** Hidden preview text shown in email clients. */
  previewText?: string;
  /** Skip CSS inlining (keep styles in <style> block only). */
  skipInlining?: boolean;
  /** Skip the <style> block entirely (only inline styles). */
  skipStyleBlock?: boolean;
  /** Extra HTML to inject into <head>. */
  headContent?: string;
}

export interface RenderEmailResult {
  /** Full email HTML document. */
  html: string;
  /** Plain text fallback. */
  text: string;
  /** Subject if provided via options. */
  subject?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface EmailMessage {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  encoding?: string;
}

export interface MailerSendOptions {
  to: string | string[];
  from: string;
  subject?: string;
  component: any;
  props?: Record<string, any>;
  renderOptions?: RenderEmailOptions;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
  };
}

export interface ResendConfig {
  apiKey: string;
}

export interface SendGridConfig {
  apiKey: string;
}
