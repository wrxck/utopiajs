// ---------------------------------------------------------------------------
// index.ts — Main entry point for @matthesketh/utopia-compiler
// ---------------------------------------------------------------------------
// Provides the top-level `compile()` function that orchestrates SFC parsing,
// template compilation, and style compilation into a single result.
// ---------------------------------------------------------------------------

export { type A11yOptions, type A11yWarning, checkA11y } from '@/a11y';
export { parse, type SFCBlock, type SFCDescriptor, SFCParseError } from '@/parser';
export {
  compileStyle,
  generateScopeId,
  preprocessStyle,
  type StyleCompileOptions,
  type StyleCompileResult,
} from '@/style-compiler';
export {
  compileTemplate,
  KNOWN_NAMED_ENTITIES,
  parseTemplate,
  type TemplateCompileOptions,
  type TemplateCompileResult,
} from '@/template-compiler';

import { type A11yOptions, type A11yWarning, checkA11y } from '@/a11y';
import { parse } from '@/parser';
import { compileStyle, preprocessStyle } from '@/style-compiler';
import { compileTemplate, parseTemplate } from '@/template-compiler';

// ---- Public types ----------------------------------------------------------

export interface CompileOptions {
  /** Filename for error messages and scope-id generation. */
  filename?: string;
  /** Override the scope ID for testing. */
  scopeId?: string;
  /** Accessibility checking options. Pass false to disable entirely. */
  a11y?: A11yOptions | false;
}

export interface CompileResult {
  /** The compiled JavaScript module source. */
  code: string;
  /** Extracted CSS (with scoping applied if the style block is `scoped`). */
  css: string;
  /** Source map (reserved for future use). */
  map?: unknown;
  /** Accessibility warnings from template analysis. */
  a11y: A11yWarning[];
}

// ---- Main compile function -------------------------------------------------

/**
 * Compile a `.utopia` single-file component source string.
 *
 * Returns the generated JavaScript module code and CSS string.
 *
 * The generated JS module has the shape:
 * ```js
 * import { ... } from '@matthesketh/utopia-runtime'
 *
 * // <script> block contents (user code) inlined here
 *
 * function __render() { ... }
 * export default { render: __render }
 * ```
 *
 * The caller (e.g. the Vite plugin) is responsible for injecting the CSS
 * into the page (via a `<style>` tag, or a CSS module import, etc.).
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const filename = options.filename ?? 'anonymous.utopia';

  // 1. Parse the SFC.
  const descriptor = parse(source, filename);

  // 2. Compile the style block (if present) to determine scoping.
  let css = '';
  let scopeId: string | null = null;

  if (descriptor.style) {
    const isScoped = 'scoped' in descriptor.style.attrs;
    const lang =
      typeof descriptor.style.attrs.lang === 'string' ? descriptor.style.attrs.lang : undefined;
    // run scss/sass through the preprocessor before scoping; plain css passes
    // through untouched.
    const styleSource = preprocessStyle(descriptor.style.content, lang, filename);
    const styleResult = compileStyle({
      source: styleSource,
      filename,
      scoped: isScoped,
      scopeId: options.scopeId,
    });
    css = styleResult.css;
    scopeId = styleResult.scopeId;
  }

  // 3. Compile the template block and run a11y checks.
  let renderModule = '';
  let a11yWarnings: A11yWarning[] = [];
  if (descriptor.template) {
    const templateResult = compileTemplate(descriptor.template.content, {
      scopeId: scopeId ?? undefined,
    });
    renderModule = templateResult.code;

    // Run a11y checks unless explicitly disabled.
    if (options.a11y !== false) {
      const ast = parseTemplate(descriptor.template.content);
      a11yWarnings = checkA11y(ast, options.a11y ?? undefined);
    }
  }

  // assemble the final module from the render imports, the user script and the
  // render function. we split the render module's import line from its body so
  // the user script can sit between them.
  const { imports, body } = splitModuleParts(renderModule);

  const scriptContent = descriptor.script?.content ?? '';

  // A component opts in to per-instance props by calling defineProps() in its
  // script. Without it, we keep the historical module-scope shape verbatim so
  // every existing component compiles byte-for-byte identically.
  const code =
    usesDefineProps(scriptContent) && body
      ? assemblePropsModule(imports, scriptContent, body)
      : assembleModuleScope(imports, scriptContent, body);

  return { code, css, a11y: a11yWarnings };
}

/**
 * The original module-scope assembly: the user script runs once at import and
 * the render function closes over it. Components are effectively singletons.
 */
function assembleModuleScope(imports: string, scriptContent: string, body: string): string {
  const parts: string[] = [];
  if (imports) {
    parts.push(imports);
  }
  // the user script may carry its own imports; bundlers handle the extra
  // import sections fine, so we keep it verbatim at module scope.
  if (scriptContent.trim()) {
    parts.push(scriptContent.trim());
  }
  if (body) {
    parts.push(body);
  }
  parts.push(`${DEFAULT_EXPORT} { render: __render }`);

  return parts.join('\n\n') + '\n';
}

/**
 * Per-instance assembly: the user script becomes the body of a `setup(props)`
 * function so each mounted instance gets its own signals, and the render
 * function is nested inside so it closes over both the script and the props.
 *
 * The runtime calls `setup(props)` then `render(ctx)`, so props authored as
 * `const { x } = defineProps()` flow straight through. Reactive props are
 * achieved the idiomatic way — pass a signal (uncalled) and read it with `x()`.
 *
 * User `import` statements are hoisted to module scope because imports cannot
 * live inside a function body.
 */
function assemblePropsModule(imports: string, scriptContent: string, body: string): string {
  const { importLines, rest } = hoistImports(scriptContent);

  // a type parameter (defineProps<T>()) can contain `>` (arrows, nested
  // generics) which a regex cannot balance — ask for a cast instead, which is
  // equivalent and unambiguous.
  if (DEFINE_PROPS_GENERIC_RE.test(stripComments(rest))) {
    throw new Error(
      '[utopia] defineProps<T>() is not supported — type the result instead, e.g. const { x } = defineProps() as { x: () => string }',
    );
  }

  // defineProps() is a compile-time macro that resolves to the setup parameter.
  // a replacer function avoids `$` in the parameter name being read as a
  // replacement-pattern token.
  const setupBody = rest.replace(DEFINE_PROPS_EMPTY_RE, () => PROPS_PARAM);

  // any defineProps call left after rewriting the no-argument form takes
  // arguments, which are not supported — fail loudly rather than emit an
  // undefined reference at runtime.
  if (DEFINE_PROPS_CALL_RE.test(stripComments(setupBody))) {
    throw new Error(
      '[utopia] defineProps() takes no arguments — destructure the props you need, e.g. const { x } = defineProps()',
    );
  }

  const parts: string[] = [];
  if (imports) {
    parts.push(imports);
  }
  for (const line of importLines) {
    parts.push(line);
  }

  parts.push(
    `function __setup(${PROPS_PARAM}) {\n${setupBody}\n\n${body}\n\n  return { __render };\n}`,
  );
  parts.push(`${DEFAULT_EXPORT} { setup: __setup, render: (__ctx) => __ctx.__render(__ctx) }`);

  return parts.join('\n\n') + '\n';
}

// detects defineProps usage (a call or a generic call), ignoring comments.
// non-global so `.test()` is stateless — a `/g` regex would carry lastIndex
// between calls and intermittently miss a real call.
function usesDefineProps(script: string): boolean {
  return DEFINE_PROPS_DETECT_RE.test(stripComments(script));
}

const DEFINE_PROPS_DETECT_RE = /\bdefineProps\s*[(<]/;
const DEFINE_PROPS_GENERIC_RE = /\bdefineProps\s*</;
const DEFINE_PROPS_CALL_RE = /\bdefineProps\s*\(/;
const DEFINE_PROPS_EMPTY_RE = /\bdefineProps\s*\(\s*\)/g;

// the parameter a per-instance component receives. an unusual name so authored
// scripts are very unlikely to redeclare it (a plain `props` would collide).
const PROPS_PARAM = '__uProps';

// strip block and line comments (best-effort; used only for opt-in detection so
// a defineProps() mentioned in a comment never flips the component shape).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// the component contract is a default export. we build the keyword from parts
// so this codegen string is never mistaken for a real default export by tooling.
const DEFAULT_EXPORT = ['export', 'default'].join(' ');

/**
 * Pull leading/standalone ES `import` statements out of a script body so they
 * can sit at module scope while the rest moves inside `setup()`. Handles both
 * `import X from '...'` / `import { a, b } from '...'` (including multi-line
 * brace lists) and side-effect `import '...'` forms.
 */
function hoistImports(script: string): { importLines: string[]; rest: string } {
  const importLines: string[] = [];
  const rest = script.replace(IMPORT_STATEMENT_RE, (match) => {
    importLines.push(match.trim());
    return '';
  });
  return { importLines, rest: rest.trim() };
}

// `import ... from '...'` / `export ... from '...'` (specifier list may span
// lines) or a bare side-effect `import '...'`, each with an optional trailing
// line comment. anchored at line starts so identifiers named like imports
// inside the body are never matched. re-exports are hoisted too because an
// `export` statement is just as illegal inside a function body as an import.
const IMPORT_STATEMENT_RE =
  /^[ \t]*(?:import|export)\b[^'"]*?\bfrom[ \t]*['"][^'"]+['"];?[ \t]*(?:\/\/[^\n]*)?$|^[ \t]*import[ \t]*['"][^'"]+['"];?[ \t]*(?:\/\/[^\n]*)?$/gm;

// ---- Internal helpers -------------------------------------------------------

/**
 * Split the generated render module into its import declaration(s) and the
 * function body.  This allows us to place the user script between them.
 */
function splitModuleParts(moduleCode: string): { imports: string; body: string } {
  // The template compiler generates code in the form:
  //   import { ... } from '@matthesketh/utopia-runtime'
  //
  //   function __render() { ... }
  //
  // We split at the first blank line (double newline).
  const idx = moduleCode.indexOf('\n\n');
  if (idx === -1) {
    return { imports: '', body: moduleCode };
  }

  const imports = moduleCode.slice(0, idx).trim();
  const body = moduleCode.slice(idx).trim();
  return { imports, body };
}
