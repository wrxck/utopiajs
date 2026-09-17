import { dirname } from 'node:path';

import { requirePeer } from './peer.js';

const TS_LANGS = new Set(['ts', 'typescript']);
const JS_LANGS = new Set(['js', 'javascript']);

/**
 * Whether a `<script lang="...">` needs transpiling before it can be emitted.
 *
 * A component with no `lang` is JavaScript and is emitted verbatim, exactly as
 * it always was. That keeps the `typescript` package an optional peer: a
 * project that authors no TypeScript never needs it installed.
 */
export function needsTranspile(lang: string | undefined): boolean {
  return lang !== undefined && TS_LANGS.has(lang);
}

/**
 * Compile a `<script>` body to JavaScript.
 *
 * Types are stripped; they are never checked here. Checking is a whole-program
 * question and belongs to `utopia check`, which can see the other modules a
 * component imports. A single-file transpile cannot answer it and must not
 * pretend to.
 */
export function compileScript(source: string, lang: string | undefined, filename: string): string {
  if (lang !== undefined && !TS_LANGS.has(lang) && !JS_LANGS.has(lang)) {
    throw new Error(
      `unsupported <script lang="${lang}"> — supported values are: js, javascript, ts, typescript`,
    );
  }

  if (!needsTranspile(lang)) return source;

  let typescript: typeof import('typescript');
  try {
    typescript = requirePeer('typescript') as typeof import('typescript');
  } catch {
    throw new Error(
      `<script lang="${lang}"> requires the "typescript" package. install it with: npm install -D typescript`,
    );
  }

  const result = typescript.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: typescript.ScriptTarget.ESNext,
      // the output is fed straight to a bundler, so module syntax is preserved
      // rather than lowered.
      module: typescript.ModuleKind.ESNext,
      // one component is transpiled alone, with no view of the modules it
      // imports. that is exactly what isolatedModules describes, and saying so
      // turns the constructs it cannot support into errors here rather than
      // into wrong output later.
      isolatedModules: true,
      // a binding used only in <template> looks unused to a transpiler that
      // sees the script alone, and ordinary elision would delete its import.
      verbatimModuleSyntax: true,
      // the bundler owns source maps; an inline one here would be discarded.
      sourceMap: false,
    },
  });

  const fatal = (result.diagnostics ?? []).filter(
    (d) => d.category === typescript.DiagnosticCategory.Error,
  );

  if (fatal.length > 0) {
    const detail = fatal
      .map((d) => typescript.flattenDiagnosticMessageText(d.messageText, ' '))
      .join('; ');
    throw new Error(`<script lang="${lang}"> failed to compile in ${dirname(filename)}: ${detail}`);
  }

  // the caller splices this into a setup function, where a prologue is a stray
  // string expression and the export marker Force would add is a syntax error.
  return result.outputText.replace(/^\s*['"]use strict['"];?\r?\n/, '');
}
