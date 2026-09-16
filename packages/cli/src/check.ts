import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { isUtopiaFile, toScriptText, UTOPIA_EXTENSION } from '@matthesketh/utopia-compiler';
import type * as ts from 'typescript';

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
  const roots = [...parsed.fileNames, ...extraRoots.map((f) => resolve(f))];
  const host = utopiaCompilerHost(typescript, options);
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
function utopiaCompilerHost(typescript: typeof ts, options: ts.CompilerOptions): ts.CompilerHost {
  const host = typescript.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
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
      toScriptText(source, fileName),
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
        const resolvedFileName = resolve(dirname(containingFile), name);
        return {
          resolvedModule: {
            resolvedFileName,
            extension: typescript.Extension.Ts,
            isExternalLibraryImport: false,
          },
        };
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

function format(typescript: typeof ts, diagnostics: readonly ts.Diagnostic[]): string {
  return typescript.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: typescript.sys.getCurrentDirectory,
    getNewLine: () => typescript.sys.newLine,
  });
}
