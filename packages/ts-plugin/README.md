# @matthesketh/utopia-ts-plugin

TypeScript language-service plugin for [UtopiaJS](https://github.com/wrxck/utopiajs) `.utopia` single-file components.

Without it, a `.utopia` file is invisible to TypeScript. Move or rename a module in your editor and every import of it is updated — except the ones inside your components, which silently rot. This plugin puts components into the compilation so that stops happening.

It masks everything outside the `<script>` block to whitespace and hands the result to the language service — the same technique [`@matthesketh/eslint-plugin-utopia`](https://github.com/wrxck/utopiajs/tree/main/packages/eslint-plugin-utopia) uses. Because the masked text is the same length as the file, every offset, line and column maps by identity, so the edits that come back apply to the `.utopia` file unchanged.

## Install

```sh
pnpm add -D @matthesketh/utopia-ts-plugin
```

`typescript` is a peer dependency.

## Usage

Add it to `compilerOptions.plugins` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@matthesketh/utopia-ts-plugin" }]
  }
}
```

In VS Code, the workspace TypeScript version must be used, because plugins only load in the version that owns them:

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "typescript.updateImportsOnFileMove.enabled": "always"
}
```

Then run **TypeScript: Select TypeScript Version → Use Workspace Version** once.

## What it does

- **Move or rename a module** and the import specifiers inside your `.utopia` components are rewritten with the rest, in both aliased (`@/lib/thing`) and relative (`../lib/thing`) form.
- **Find all references** and **rename symbol** reach into component scripts.
- **`import Foo from './Foo.utopia'`** resolves to the component.

`tsc` ignores `compilerOptions.plugins` entirely, so none of this changes what your build or `tsc --noEmit` does. It is editor behaviour only.

## Scope

This plugin makes the language service aware of components from the outside. IntelliSense _inside_ a `.utopia` editor window — hover, go-to-definition with the cursor in the `<script>` block — additionally needs a VS Code extension that contributes the language and routes those buffers to tsserver; a `tsconfig.json` entry alone cannot do that.

## How it works

- `getExternalFiles` hands the component paths to tsserver, which keeps a `ScriptInfo` for each one and watches it.
- The language-service host is patched so components are listed as roots, their snapshot is the masked script text, they count as TypeScript, and `allowNonTsExtensions` lets the unfamiliar extension into the compilation.
- Module resolution answers the `<name>.utopia.ts` probe TypeScript makes for a `.utopia` specifier, then maps the result back to the component itself, so no invented path escapes into the rest of the system.
- Everything that is not a `.utopia` specifier is left to the host's own resolver untouched, including its record of failed lookups — which is how a rename is still matched up after the moved file has already left its old path.

## Licence

MIT
