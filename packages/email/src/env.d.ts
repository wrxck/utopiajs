// Ambient module declarations for optional peer dependencies.
// These are dynamically imported at runtime only when the adapter is used.
declare module 'nodemailer' {
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }
  interface MailOptions {
    from?: string;
    to: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    subject?: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      filename?: string;
      content?: string | Buffer;
      contentType?: string;
      encoding?: string;
    }>;
  }
  interface SentMessageInfo {
    messageId: string;
  }
  interface Transporter {
    sendMail(options: MailOptions): Promise<SentMessageInfo>;
  }
  export function createTransport(config: TransportOptions): Transporter;
}

declare module 'resend' {
  interface SendEmailOptions {
    from: string;
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    reply_to?: string;
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
    attachments?: Array<{ filename?: string; content?: string | Buffer; content_type?: string }>;
  }
  interface SendEmailResponse {
    data?: { id: string };
    id?: string;
  }
  export class Resend {
    constructor(apiKey: string);
    emails: { send(options: SendEmailOptions): Promise<SendEmailResponse> };
  }
  export default Resend;
}

declare module '@sendgrid/mail' {
  interface SendGridMessage {
    to: string | string[];
    from: string;
    subject: string;
    html?: string;
    text?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      filename?: string;
      content?: string;
      type?: string;
      disposition?: string;
    }>;
  }
  interface SendGridResponse {
    statusCode: number;
    headers: Record<string, string>;
  }
  export function setApiKey(key: string): void;
  export function send(msg: SendGridMessage): Promise<[SendGridResponse, Record<string, unknown>]>;
}
