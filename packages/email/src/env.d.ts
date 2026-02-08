// Ambient module declarations for optional peer dependencies.
// These are dynamically imported at runtime only when the adapter is used.
declare module 'nodemailer' {
  const nodemailer: any;
  export default nodemailer;
  export function createTransport(config: any): any;
}

declare module 'resend' {
  export class Resend {
    constructor(apiKey: string);
    emails: { send(options: any): Promise<any> };
  }
  export default Resend;
}

declare module '@sendgrid/mail' {
  const sgMail: any;
  export default sgMail;
  export function setApiKey(key: string): void;
  export function send(msg: any): Promise<any>;
}
