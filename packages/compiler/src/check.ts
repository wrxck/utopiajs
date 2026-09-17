import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type * as ts from 'typescript';

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
}

/**
 * Type-check a project including its `.utopia` components.
 *
 * `tsc` will not accept `.utopia` as the root of a compilation and will not
 * resolve an import that ends in it, so a plain `tsc --noEmit` silently omits
 * every component. This builds a program that does both.
 *
 * A component is presented as its script body with everything else blanked,
 * which keeps every offset identical to the file on disk — so a diagnostic
 * points at the component without any position mapping.
 */
export function check(
  typescript: typeof ts,
  configPath: string,
  extraRoots: string[] = [],
): CheckResult {
  const configDir = dirname(configPath);
  const read = typescript.readConfigFile(configPath, typescript.sys.readFile);

  if (read.error) {
    return {
      diagnostics: [format(typescript, [read.error])],
      errorCount: 1,
      fileCount: 0,
    };
  }

  const parsed = typescript.parseJsonConfigFileContent(read.config, typescript.sys, configDir);
  // .utopia is not an extension typescript accepts as a root of a compilation.
  // this is the switch that lifts that check - the same one the editor sets for
  // an untitled buffer. without it every component is silently dropped and the
  // check passes while seeing nothing.
  const options: ts.CompilerOptions = { ...parsed.options, allowNonTsExtensions: true };
  const macrosPath = resolve(configDir, MACROS_FILE);
  const roots = [...parsed.fileNames, ...extraRoots.map((f) => resolve(f)), macrosPath];
  const host = utopiaCompilerHost(typescript, options, macrosPath);
  const program = typescript.createProgram(roots, options, host);

  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];

  return {
    diagnostics: diagnostics.length > 0 ? [format(typescript, diagnostics)] : [],
    errorCount: diagnostics.filter((d) => d.category === typescript.DiagnosticCategory.Error)
      .length,
    fileCount: roots.filter(isUtopiaFile).length,
  };
}

/**
 * A compiler host that reads a component as TypeScript and resolves an import
 * that names one.
 */
function utopiaCompilerHost(
  typescript: typeof ts,
  options: ts.CompilerOptions,
  macrosPath: string,
): ts.CompilerHost {
  const host = typescript.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);

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

    return typescript.createSourceFile(
      fileName,
      toScriptText(source, fileName) + COMPONENT_DEFAULT_EXPORT,
      languageVersion,
      true,
      typescript.ScriptKind.TS,
    );
  };

  // typescript resolves `./Foo.utopia` by probing for `./Foo.utopia.ts` and
  // giving up. the specifier names a real file, so answer with it directly.
  host.resolveModuleNameLiterals = (literals, containingFile, redirected, compilerOptions) =>
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

      return typescript.resolveModuleName(
        name,
        containingFile,
        compilerOptions,
        host,
        undefined,
        redirected,
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

function format(typescript: typeof ts, diagnostics: readonly ts.Diagnostic[]): string {
  return typescript.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: typescript.sys.getCurrentDirectory,
    getNewLine: () => typescript.sys.newLine,
  });
}
