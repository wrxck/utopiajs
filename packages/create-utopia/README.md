# create-utopia

Scaffold a new UtopiaJS project.

## Usage

```bash
npx create-utopia my-app
```

Or with other package managers:

```bash
pnpm create utopia my-app
yarn create utopia my-app
bun create utopia my-app
```

## Features

The interactive CLI prompts for:

- **Project name** -- validates as a legal npm package name
- **Language** -- TypeScript (default) or JavaScript
- **Features** -- select any combination:
  - Router (file-based routing)
  - SSR (server-side rendering with Express)
  - Email (template-based emails)
  - AI (chat, streaming, adapters)
  - CSS Preprocessor (Sass or Less)
- **Git initialization** -- optional initial commit

## What It Creates

```
my-app/
  index.html
  package.json
  vite.config.ts
  tsconfig.json        # TypeScript only
  src/
    main.ts
    App.utopia
    routes/            # if Router selected
      +page.utopia
      +layout.utopia
  server.js            # if SSR selected
  src/
    entry-client.ts    # if SSR selected
    entry-server.ts    # if SSR selected
```

When AI is selected, an example chat API route is scaffolded at `src/routes/api/chat/+server.ts` with a `.env.example` file.

## Programmatic

The CLI is the primary interface. The package exports no public API -- it runs directly via the `create-utopia` bin entry point.

## License

MIT
