# Email Templates

`@utopia/email` provides template-based email rendering using UtopiaJS components. Render `.utopia` components to email-safe HTML with automatic CSS inlining and plain text fallback generation. Adapter pattern for sending via SMTP, Resend, or SendGrid.

## Quick Start

```bash
pnpm add @utopia/email
```

```ts
import { createMailer } from '@utopia/email';
import { smtpAdapter } from '@utopia/email/smtp';
import WelcomeEmail from './emails/Welcome.utopia';

const mailer = createMailer(smtpAdapter({
  host: 'smtp.example.com',
  port: 587,
  auth: { user: 'user', pass: 'pass' },
}));

await mailer.send({
  to: 'user@example.com',
  from: 'noreply@example.com',
  subject: 'Welcome!',
  component: WelcomeEmail,
  props: { name: 'Alice' },
});
```

## Rendering Pipeline

`renderEmail()` orchestrates the full pipeline from component to email-ready HTML + plain text:

```
  .utopia component + props
          │
     1. renderToString(component, props)
          │
     { html: bodyHtml, css }
          │
     2. inlineCSS(bodyHtml, css)
          │
     bodyHtml with style="" attributes
          │
     3. wrapEmailDocument({ bodyHtml, css, previewText, ... })
          │
     full HTML document (<!DOCTYPE html>...)
          │
     4. htmlToText(fullHtml)
          │
     plain text fallback
          │
     { html, text, subject? }
```

### `renderEmail(component, props?, options?)`

```ts
import { renderEmail } from '@utopia/email';
import WelcomeEmail from './emails/Welcome.utopia';

const { html, text, subject } = renderEmail(WelcomeEmail, { name: 'Alice' }, {
  subject: 'Welcome!',
  previewText: 'Thanks for signing up',
});
```

**RenderEmailOptions:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `subject` | `string` | -- | Email subject line |
| `previewText` | `string` | -- | Hidden preview text shown in email clients |
| `skipInlining` | `boolean` | `false` | Skip CSS inlining (keep styles in `<style>` only) |
| `skipStyleBlock` | `boolean` | `false` | Skip the `<style>` block (inline styles only) |
| `headContent` | `string` | -- | Extra HTML to inject into `<head>` |

**RenderEmailResult:**

| Field | Type | Description |
|-------|------|-------------|
| `html` | `string` | Full email HTML document |
| `text` | `string` | Plain text fallback |
| `subject` | `string` | Subject if provided via options |

## Adapters

| Provider | Import Path | Config Type | Peer Dependency |
|----------|-------------|-------------|-----------------|
| SMTP | `@utopia/email/smtp` | `SmtpConfig` | `nodemailer` |
| Resend | `@utopia/email/resend` | `ResendConfig` | `resend` |
| SendGrid | `@utopia/email/sendgrid` | `SendGridConfig` | `@sendgrid/mail` |

All provider SDKs are optional peer dependencies. Install only the one you need.

### Config Types

```ts
interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
}

interface ResendConfig {
  apiKey: string;
}

interface SendGridConfig {
  apiKey: string;
}
```

### Adapter Example

```ts
import { createMailer } from '@utopia/email';
import { resendAdapter } from '@utopia/email/resend';

const mailer = createMailer(resendAdapter({
  apiKey: process.env.RESEND_API_KEY!,
}));
```

## Email Components

Built-in components for common email patterns. These are standard UtopiaJS components that render to table-based, email-client-safe HTML.

| Component | Description |
|-----------|-------------|
| `EmailLayout` | Top-level email wrapper (sets width, background, font stack) |
| `EmailButton` | Call-to-action button (table-based for Outlook compatibility) |
| `EmailCard` | Bordered content card with padding |
| `EmailDivider` | Horizontal rule / visual separator |
| `EmailHeading` | Heading text (h1-h6) |
| `EmailText` | Body text paragraph |
| `EmailImage` | Responsive image with alt text |
| `EmailColumns` | Multi-column layout (table-based) |
| `EmailSpacer` | Vertical spacing element |

```ts
import {
  EmailLayout,
  EmailButton,
  EmailCard,
  EmailHeading,
  EmailText,
} from '@utopia/email';
```

Use these inside `.utopia` email templates:

```html
<template>
  <EmailLayout>
    <EmailCard>
      <EmailHeading>Welcome, {{ name() }}!</EmailHeading>
      <EmailText>Thanks for signing up.</EmailText>
      <EmailButton href="https://example.com/dashboard">
        Get Started
      </EmailButton>
    </EmailCard>
  </EmailLayout>
</template>

<script>
import { signal } from '@utopia/core';
const props = defineProps<{ name: string }>();
const name = signal(props.name);
</script>
```

## CSS Inlining

`inlineCSS(html, css)` converts scoped CSS rules into inline `style=""` attributes on each matching HTML element. This is essential for email rendering because most email clients strip `<style>` blocks.

The inliner:

- Parses CSS rules and calculates selector specificity
- Matches selectors against elements (supports tag, class, ID, attribute, descendant, and child combinators)
- Merges declarations respecting specificity and source order
- Preserves existing inline styles (highest priority)
- Skips `@media` and other at-rules

```ts
import { inlineCSS } from '@utopia/email';

const html = '<div class="card"><p>Hello</p></div>';
const css = '.card { padding: 20px; } .card p { color: #333; }';

const result = inlineCSS(html, css);
// '<div class="card" style="padding: 20px"><p style="color: #333">Hello</p></div>'
```

## Plain Text

`htmlToText(html)` converts an HTML email document to a plain text fallback suitable for email clients that do not render HTML.

Conversion rules:

- Links become `text (url)` format
- Headings are uppercased with surrounding blank lines
- `<br>` becomes newline, `<hr>` becomes `---`
- List items get `- ` prefix
- Block elements get trailing newlines, table cells get tabs
- HTML entities are decoded
- Whitespace is collapsed and lines are trimmed

```ts
import { htmlToText } from '@utopia/email';

const text = htmlToText(emailHtml);
```

## API Reference

### `createMailer(adapter)`

Create a mailer instance with the given adapter.

**Returns:** `Mailer` with a single `send(options)` method.

### `mailer.send(options)`

Render a component and send the email.

**MailerSendOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `to` | `string \| string[]` | Recipient(s) (required) |
| `from` | `string` | Sender address (required) |
| `subject` | `string` | Email subject |
| `component` | `any` | Compiled `.utopia` component (required) |
| `props` | `Record<string, any>` | Props to pass to the component |
| `renderOptions` | `RenderEmailOptions` | Rendering options (previewText, skipInlining, etc.) |
| `cc` | `string \| string[]` | CC recipients |
| `bcc` | `string \| string[]` | BCC recipients |
| `replyTo` | `string` | Reply-to address |
| `attachments` | `EmailAttachment[]` | File attachments |

**Returns:** `Promise<EmailResult>` with `{ success: boolean, messageId?: string, error?: string }`.

### `renderEmail(component, props?, options?)`

Render a component to email HTML + plain text without sending. See [Rendering Pipeline](#rendering-pipeline) above.

### `inlineCSS(html, css)`

Inline CSS declarations into HTML `style=""` attributes.

**Parameters:**
- `html` -- Well-formed HTML string
- `css` -- CSS string (scoped styles)

**Returns:** HTML string with inline styles applied.

### `htmlToText(html)`

Convert HTML to plain text.

**Parameters:**
- `html` -- HTML string

**Returns:** Plain text string.

## Type Reference

All types are exported from `@utopia/email`.

| Type | Description |
|------|-------------|
| `RenderEmailOptions` | Options for `renderEmail()` |
| `RenderEmailResult` | Result of `renderEmail()` (html, text, subject) |
| `EmailAdapter` | Adapter interface (`send(message)`) |
| `EmailMessage` | Full email message (to, from, subject, html, text, cc, bcc, ...) |
| `EmailResult` | Send result (`success`, `messageId`, `error`) |
| `EmailAttachment` | Attachment (filename, content, contentType, encoding) |
| `MailerSendOptions` | Options for `mailer.send()` |
| `SmtpConfig` | SMTP adapter configuration |
| `ResendConfig` | Resend adapter configuration |
| `SendGridConfig` | SendGrid adapter configuration |
