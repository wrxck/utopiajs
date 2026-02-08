# UtopiaJS Kitchen Sink

Example project demonstrating every UtopiaJS feature in one app.

## Features Used

- **Signals**: `signal()`, `computed()`, `effect()`, `batch()`, `untrack()`
- **Template directives**: `{{ interpolation }}`, `@click`, `u-if`, `u-for`, `u-model`, `:class`
- **File-based routing**: `+page.utopia`, `+layout.utopia`, `[slug]` params, `(auth)` route groups
- **SSR**: Server-side rendering with `renderToString` + cursor-based hydration
- **AI chat**: OpenAI adapter with SSE streaming (`streamSSE` + `parseSSEStream`)
- **AI tool calling**: Agentic loop with `ai.run()`, local tools + MCP bridge
- **MCP server**: JSON-RPC 2.0 server with tools, resources, and prompts
- **Email**: SMTP adapter with `createMailer`
- **Scoped CSS**: Per-component scoped styles

## Project Structure

```
src/
  App.utopia                        Root component (nav + RouterView)
  entry-client.ts                   Client entry — hydrate()
  entry-server.ts                   Server entry — renderToString()
  routes/
    +layout.utopia                  Root layout
    +page.utopia                    Home — signals, directives, batch demos
    dashboard/+page.utopia          Dashboard — computed signals, effects
    chat/+page.utopia               AI chat — SSE streaming UI
    blog/[slug]/+page.utopia        Blog post — dynamic route params
    (auth)/login/+page.utopia       Login — route groups, u-model, u-if
    api/
      chat/+server.ts              AI chat API — OpenAI + streamSSE
      chat/tools.ts                Agentic tool calling + MCP bridge
      email/+server.ts             Email API — SMTP adapter
      mcp/+server.ts               MCP server — tools, resources, prompts
```

## Setup

```bash
cp .env.example .env
# Edit .env with your API keys

pnpm install
pnpm dev
```

## Routes

| URL | Page | Features |
|-----|------|----------|
| `/` | Home | signal, computed, effect, batch, untrack, u-if, u-for, u-model |
| `/dashboard` | Dashboard | Computed signals, effects, u-for, dynamic :class |
| `/chat` | AI Chat | SSE streaming, fetch API, @utopia/ai |
| `/blog/hello-world` | Blog | Dynamic [slug] param, computed |
| `/login` | Login | Route groups (auth), u-model, u-if, form handling |
| `POST /api/chat` | API | OpenAI streaming via @utopia/ai |
| `POST /api/email` | API | SMTP email via @utopia/email |
| `POST /api/mcp` | API | MCP server via @utopia/ai/mcp |

## License

AGPL-3.0-or-later
