import type * as ts from 'typescript';

import { utopiaFilesFor } from './files';
import { patchLanguageServiceHost } from './host';
import { createPlugin } from './plugin';

// tsserver language-service plugin: makes .utopia components first-class members
// of the compilation, so that moving or renaming a module updates the import
// specifiers inside them, and so definitions, references and renames reach into
// them.
//
// note this affects editors only. `tsc` ignores compilerOptions.plugins
// entirely, so nothing here changes typecheck, lint or build output.
function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const typescript = modules.typescript;

  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      const files = utopiaFilesFor(typescript, info.project);
      const patched = patchLanguageServiceHost(typescript, info, files);

      // the tsserver logger is the only supported output channel for a plugin;
      // this line is what tells you it loaded rather than failed to resolve.
      info.project.projectService.logger.info(
        `[utopia-ts-plugin] create: typescript ${typescript.version}, ` +
          `project ${info.project.getProjectName()}, ` +
          `${files.list().length} .utopia components, host patched: ${patched}`,
      );

      return createPlugin(info);
    },

    // hands the component paths to tsserver so it keeps a ScriptInfo for each
    // one attached to the project and watches it for changes.
    getExternalFiles(project: ts.server.Project): string[] {
      return utopiaFilesFor(typescript, project).list();
    },
  };
}

export = init;
