import type * as ts from 'typescript';

import type { UtopiaFiles } from './files';
import { fromProbePath, isProbePath, isUtopiaFile } from './utopia';

const PATCHED = Symbol.for('@utopiajs/ts-plugin.host-patched');

type PatchableHost = ts.LanguageServiceHost & Record<symbol, boolean | undefined>;

// teach the language service host about .utopia components.
//
// tsserver passes the project itself as the host, so these overrides are what
// put every component into the compilation: it is listed as a root, its snapshot
// is the script block with everything else blanked out, it counts as typescript,
// and an import specifier ending in .utopia resolves to it. without this the
// language service is never asked about components at all, and a proxy over it
// has nothing to answer with.
export function patchLanguageServiceHost(
  typescript: typeof ts,
  info: ts.server.PluginCreateInfo,
  files: UtopiaFiles,
): boolean {
  const host = info.languageServiceHost as PatchableHost;

  // create() runs again whenever the project reloads; patching the same host
  // twice would stack the overrides.
  if (host[PATCHED]) {
    return false;
  }

  host[PATCHED] = true;

  // .utopia is not an extension typescript accepts as a root of the
  // compilation, and this is the switch that lifts that check. it is the same
  // switch the editor sets for untitled buffers.
  const getCompilationSettings = host.getCompilationSettings.bind(host);

  host.getCompilationSettings = () => {
    const options = getCompilationSettings();

    if (!options.allowNonTsExtensions) {
      options.allowNonTsExtensions = true;
    }

    return options;
  };

  const getScriptFileNames = host.getScriptFileNames.bind(host);

  host.getScriptFileNames = () => {
    const names = getScriptFileNames();
    const components = files.list();

    return components.length > 0 ? names.concat(components) : names;
  };

  const getScriptVersion = host.getScriptVersion.bind(host);
  const getScriptSnapshot = host.getScriptSnapshot.bind(host);

  // the raw snapshot is fetched from the unpatched host first, which is what
  // creates and attaches the ScriptInfo tsserver requires for any file in the
  // compilation, and gives us the current text and version for free.
  host.getScriptSnapshot = (fileName) => {
    if (!isUtopiaFile(fileName)) {
      return getScriptSnapshot(fileName);
    }

    const source = getScriptSnapshot(fileName);

    if (!source) {
      return undefined;
    }

    return files.snapshot(fileName, getScriptVersion(fileName) ?? '', () =>
      source.getText(0, source.getLength()),
    );
  };

  const getScriptKind = host.getScriptKind?.bind(host);

  host.getScriptKind = (fileName) => {
    if (isUtopiaFile(fileName)) {
      return typescript.ScriptKind.TS;
    }

    return getScriptKind ? getScriptKind(fileName) : typescript.ScriptKind.Unknown;
  };

  patchModuleResolution(typescript, host);

  return true;
}

// resolve `import Foo from './Foo.utopia'` (and the aliased `@/components/...`
// form) to the component itself.
//
// everything that is not a .utopia specifier is left to the host's own resolver,
// untouched — including its record of failed lookups, which is how a rename is
// still matched up after the moved file has already left its old path.
function patchModuleResolution(typescript: typeof ts, host: PatchableHost): void {
  const resolveModuleNameLiterals = host.resolveModuleNameLiterals?.bind(host);

  if (!resolveModuleNameLiterals) {
    return;
  }

  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);

  // typescript probes for `<name>.utopia.ts` because .utopia is not an
  // extension it knows. answering that probe here, rather than on the host
  // itself, keeps the invented path out of every other code path.
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: (candidate) =>
      isProbePath(candidate) ? fileExists(fromProbePath(candidate)) : fileExists(candidate),
    readFile,
    directoryExists: host.directoryExists?.bind(host),
    getCurrentDirectory: host.getCurrentDirectory.bind(host),
    realpath: host.realpath?.bind(host),
    useCaseSensitiveFileNames: host.useCaseSensitiveFileNames?.bind(host),
  };

  host.resolveModuleNameLiterals = (
    moduleLiterals,
    containingFile,
    redirectedReference,
    options,
    containingSourceFile,
    reusedNames,
  ) => {
    const resolved = resolveModuleNameLiterals(
      moduleLiterals,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile,
      reusedNames,
    );

    // almost no file imports a component, and the host's own result is a
    // cached array the compiler reuses between updates. handing back a fresh
    // one for every file in the project instead cost ten seconds of load time
    // on a three thousand file repository, so leave it alone unless there is
    // actually something here to change.
    if (!moduleLiterals.some((literal) => isUtopiaFile(literal.text))) {
      return resolved;
    }

    return moduleLiterals.map((literal, index) => {
      const fallback = resolved[index] ?? { resolvedModule: undefined };

      if (!isUtopiaFile(literal.text)) {
        return fallback;
      }

      const probe = typescript.resolveModuleName(
        literal.text,
        containingFile,
        options,
        resolutionHost,
        undefined,
        redirectedReference,
      ).resolvedModule;

      if (!probe || !isProbePath(probe.resolvedFileName)) {
        return fallback;
      }

      return {
        resolvedModule: {
          resolvedFileName: fromProbePath(probe.resolvedFileName),
          extension: typescript.Extension.Ts,
          isExternalLibraryImport: false,
        },
      };
    });
  };
}
