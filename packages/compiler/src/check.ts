import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type * as ts from 'typescript';

import { parse } from '@/parser';
import { isUtopiaFile, toScriptText, UTOPIA_EXTENSION } from '@/script-text';

// a script alone has no default export, and only never suits whatever component type the host declares
const COMPONENT_DEFAULT_EXPORT = '\nexport default undefined as unknown as never;\n';

// defineProps is a compiler macro: the compiler turns it into the setup
// signature and it never exists at runtime. without an ambient declaration
// every component that opts into props reads as "cannot find name".
const MACROS_FILE = 'utopia-macros.d.ts';
const MACROS = 'declare function defineProps<T = Record<string, unknown>>(): T;\n';

export interface CheckResult {
  diagnostics: string[];
  errorCount: number;
  fileCount: number;
  /** Absolute paths of the components the program checked. */
  files: string[];
  /**
   * Components under the config directory that the tsconfig does not exclude
   * but the program never reached (an include of `*.ts` only, a solution
   * config with `files: []`, a route page nothing imports). Empty when the
   * config itself failed to parse.
   */
  unreached: string[];
}

export interface CheckOptions {
  /** Colour and source context in the output (default: when stdout is a TTY). */
  pretty?: boolean;
}

/** What the host learned about each component while reading it. */
interface ComponentInfo {
  /** `<script lang="ts">` — plain JavaScript components are checked like `.js`. */
  typescript: boolean;
  /** The template, where script bindings are used. */
  template: string;
}

/**
 * "declared but never read" family. A component's bindings are read by its
 * template, which the script view blanks out, so under noUnusedLocals these
 * are false for any name the template mentions.
 */
const UNUSED_CODES = new Set([6133, 6138, 6192, 6196, 6198, 6199, 6205]);

/**
 * An import kept by verbatimModuleSyntax that names only a type. The compiler
 * transpiles one component at a time with verbatimModuleSyntax (so a binding
 * the template alone uses keeps its import), and a single-file transpile
 * cannot know `Props` is a type: `import { Props }` ships as a runtime import
 * of an export that does not exist. Only a whole-program check can see it.
 */
const TYPE_ONLY_IMPORT_CODES = new Set([1484, 1485]);

/**
 * Type-check a project including its `.utopia` components.
 *
 * `tsc` will not accept `.utopia` as the root of a compilation and will not
 * resolve an import that ends in it, so a plain `tsc --noEmit` silently omits
 * every component. This builds a program that does both.
 *
 * Components are found through the tsconfig's own include/exclude (plus any
 * `extraRoots`), and each is presented as its script body with everything else
 * blanked, which keeps every offset identical to the file on disk — so a
 * diagnostic points at the component without any position mapping.
 */
export function check(
  typescript: typeof ts,
  configPath: string,
  extraRoots: string[] = [],
  checkOptions: CheckOptions = {},
): CheckResult {
  const configDir = dirname(configPath);
  const pretty = checkOptions.pretty ?? typescript.sys.writeOutputIsTTY?.() ?? false;
  const read = typescript.readConfigFile(configPath, typescript.sys.readFile);

  if (read.error) {
    return {
      diagnostics: [format(typescript, [read.error], pretty)],
      errorCount: 1,
      fileCount: 0,
      files: [],
      unreached: [],
    };
  }

  // the extra extension lets include/exclude pick components up exactly as
  // they pick up .ts files.
  const parsed = typescript.parseJsonConfigFileContent(
    read.config,
    typescript.sys,
    configDir,
    undefined,
    configPath,
    undefined,
    [
      {
        extension: UTOPIA_EXTENSION,
        isMixedContent: false,
        scriptKind: typescript.ScriptKind.Deferred,
      },
    ],
  );
  // .utopia is not an extension typescript accepts as a root of a compilation.
  // this is the switch that lifts that check - the same one the editor sets for
  // an untitled buffer. without it every component is silently dropped and the
  // check passes while seeing nothing.
  const options: ts.CompilerOptions = { ...parsed.options, allowNonTsExtensions: true };
  const macrosPath = resolve(configDir, MACROS_FILE);
  const roots = [
    ...new Set([...parsed.fileNames, ...extraRoots.map((f) => resolve(f)), macrosPath]),
  ];
  const components = new Map<string, ComponentInfo>();
  const hostDiagnostics: ts.Diagnostic[] = [];
  const host = utopiaCompilerHost(typescript, options, macrosPath, components, hostDiagnostics);
  const program = typescript.createProgram({
    rootNames: roots,
    options,
    host,
    configFileParsingDiagnostics: parsed.errors,
  });

  const semantic: ts.Diagnostic[] = [];
  for (const file of program.getSourceFiles()) {
    const component = components.get(file.fileName);
    // a plain JavaScript component is checked the way tsc checks a .js file:
    // only under checkJs. checking it as typescript failed every untyped one.
    if (component && !component.typescript && !options.checkJs) continue;
    for (const d of program.getSemanticDiagnostics(file)) {
      if (component && isTemplateUseOfUnused(d, file, component)) continue;
      semantic.push(d);
    }
  }

  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...hostDiagnostics,
    ...program.getSyntacticDiagnostics(),
    ...semantic,
    ...typeOnlyImportDiagnostics(typescript, program, roots, options, host, components),
  ];

  return {
    diagnostics: diagnostics.length > 0 ? [format(typescript, diagnostics, pretty)] : [],
    errorCount: diagnostics.filter((d) => d.category === typescript.DiagnosticCategory.Error)
      .length,
    fileCount: components.size,
    files: [...components.keys()],
    unreached:
      parsed.errors.length > 0
        ? []
        : unreachedComponents(typescript, read.config, configDir, configPath, components),
  };
}

/**
 * Components the tsconfig would allow (its exclude applied) that the program
 * did not check. Compared by real path, so a symlinked component counts once.
 */
function unreachedComponents(
  typescript: typeof ts,
  config: Record<string, unknown>,
  configDir: string,
  configPath: string,
  components: Map<string, ComponentInfo>,
): string[] {
  const everything = typescript.parseJsonConfigFileContent(
    { ...config, files: undefined, include: ['**/*'] },
    typescript.sys,
    configDir,
    undefined,
    configPath,
    undefined,
    [
      {
        extension: UTOPIA_EXTENSION,
        isMixedContent: false,
        scriptKind: typescript.ScriptKind.Deferred,
      },
    ],
  );
  const real = (f: string): string => {
    try {
      return realpathSync(f);
    } catch {
      return resolve(f);
    }
  };
  const checked = new Set([...components.keys()].map(real));
  return everything.fileNames.filter((f) => isUtopiaFile(f) && !checked.has(real(f)));
}

/** An "unused" diagnostic for a name the component's template does use. */
function isTemplateUseOfUnused(
  d: ts.Diagnostic,
  file: ts.SourceFile,
  component: ComponentInfo,
): boolean {
  if (!UNUSED_CODES.has(d.code) || d.start === undefined || d.length === undefined) return false;
  const span = file.text.slice(d.start, d.start + d.length);
  const names = span.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return names.some((name) =>
    new RegExp(`(^|[^\\w$])${escapeRegExp(name)}($|[^\\w$])`).test(component.template),
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run the TypeScript components through verbatimModuleSyntax, the setting the
 * compiler transpiles them with, and report the imports it would ship for
 * names that are only types.
 */
function typeOnlyImportDiagnostics(
  typescript: typeof ts,
  program: ts.Program,
  roots: string[],
  options: ts.CompilerOptions,
  host: ts.CompilerHost,
  components: Map<string, ComponentInfo>,
): ts.Diagnostic[] {
  const tsComponents = [...components].filter(([, c]) => c.typescript).map(([f]) => f);
  if (tsComponents.length === 0 || options.verbatimModuleSyntax) {
    // with the option already on, the main program reported them.
    return [];
  }
  const strict = typescript.createProgram({
    rootNames: roots,
    options: { ...options, verbatimModuleSyntax: true },
    host,
    oldProgram: program,
  });
  const found: ts.Diagnostic[] = [];
  for (const fileName of tsComponents) {
    const file = strict.getSourceFile(fileName);
    if (!file) continue;
    for (const d of strict.getSemanticDiagnostics(file)) {
      if (TYPE_ONLY_IMPORT_CODES.has(d.code)) found.push(d);
    }
  }
  return found;
}

/**
 * A compiler host that reads a component as TypeScript and resolves an import
 * that names one.
 */
function utopiaCompilerHost(
  typescript: typeof ts,
  options: ts.CompilerOptions,
  macrosPath: string,
  components: Map<string, ComponentInfo>,
  hostDiagnostics: ts.Diagnostic[],
): ts.CompilerHost {
  const host = typescript.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const cache = typescript.createModuleResolutionCache(
    host.getCurrentDirectory(),
    (f) => host.getCanonicalFileName(f),
    options,
  );

  host.fileExists = (fileName) => fileName === macrosPath || fileExists(fileName);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (fileName === macrosPath) {
      return typescript.createSourceFile(
        fileName,
        MACROS,
        languageVersion,
        true,
        typescript.ScriptKind.TS,
      );
    }

    if (!isUtopiaFile(fileName)) {
      return getSourceFile(fileName, languageVersion, onError, shouldCreate);
    }

    let source: string;
    try {
      source = readFileSync(fileName, 'utf8');
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
      return undefined;
    }

    // a malformed component is reported as a diagnostic and checked as empty,
    // rather than crashing the whole run.
    let text: string;
    let info: ComponentInfo;
    try {
      const descriptor = parse(source, fileName);
      const lang = descriptor.script?.attrs.lang;
      info = {
        typescript: lang === 'ts' || lang === 'typescript',
        template: descriptor.template?.content ?? '',
      };
      text = toScriptText(source, fileName);
    } catch (error) {
      hostDiagnostics.push({
        category: typescript.DiagnosticCategory.Error,
        code: 0,
        file: undefined,
        start: undefined,
        length: undefined,
        messageText: error instanceof Error ? error.message : String(error),
      });
      info = { typescript: false, template: '' };
      text = source.replace(/[^\n\r]/g, ' ');
    }
    components.set(fileName, info);

    return typescript.createSourceFile(
      fileName,
      text + COMPONENT_DEFAULT_EXPORT,
      languageVersion,
      true,
      typescript.ScriptKind.TS,
    );
  };

  // typescript resolves `./Foo.utopia` by probing for `./Foo.utopia.ts` and
  // giving up. the specifier names a real file, so answer with it directly.
  // everything else resolves as tsc would: with the program's cache and each
  // import's own resolution mode (import vs require under node16/nodenext).
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    redirected,
    compilerOptions,
    containingSourceFile,
  ) =>
    literals.map((literal) => {
      const name = literal.text;

      if (name.endsWith(UTOPIA_EXTENSION)) {
        const resolvedFileName = resolveUtopiaSpecifier(name, containingFile, compilerOptions);
        if (resolvedFileName) {
          return {
            resolvedModule: {
              resolvedFileName,
              extension: typescript.Extension.Ts,
              isExternalLibraryImport: false,
            },
          };
        }
      }

      const mode = typescript.getModeForUsageLocation(
        containingSourceFile,
        literal,
        compilerOptions,
      );
      return typescript.resolveModuleName(
        name,
        containingFile,
        compilerOptions,
        host,
        cache,
        redirected,
        mode,
      );
    });

  return host;
}

/**
 * Resolve an import that names a component.
 *
 * A relative specifier resolves against the importing file. Anything else goes
 * through the `paths` mapping, because an alias like `@/components/X.utopia` is
 * not relative to the importer and resolving it as though it were produces a
 * path that cannot exist.
 */
function resolveUtopiaSpecifier(
  name: string,
  containingFile: string,
  options: ts.CompilerOptions,
): string | undefined {
  if (name.startsWith('./') || name.startsWith('../')) {
    return resolve(dirname(containingFile), name);
  }

  const base = options.baseUrl ?? (options.pathsBasePath as string | undefined) ?? process.cwd();

  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    const star = pattern.indexOf('*');

    if (star < 0) {
      if (name !== pattern) continue;
      const hit = (targets ?? []).map((t) => resolve(base, t)).find(existsSync);
      if (hit) return hit;
      continue;
    }

    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;

    const middle = name.slice(prefix.length, name.length - suffix.length);
    const hit = (targets ?? []).map((t) => resolve(base, t.replace('*', middle))).find(existsSync);
    if (hit) return hit;
  }

  return undefined;
}

function format(
  typescript: typeof ts,
  diagnostics: readonly ts.Diagnostic[],
  pretty: boolean,
): string {
  const host = {
    getCanonicalFileName: (f: string) => f,
    getCurrentDirectory: typescript.sys.getCurrentDirectory,
    getNewLine: () => typescript.sys.newLine,
  };
  // plain text in pipes and CI logs, where colour codes are noise.
  return pretty
    ? typescript.formatDiagnosticsWithColorAndContext(diagnostics, host)
    : typescript.formatDiagnostics(diagnostics, host);
}
