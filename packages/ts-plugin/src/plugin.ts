import type * as ts from 'typescript';

import { isUtopiaFile } from './utopia';

type Delegate = (...args: unknown[]) => unknown;

// the language service proxy.
//
// there is no position or file-name translation here, and that is the point:
// components sit in the compilation under their own path, and the text they map
// to is character-for-character the same length as the file on disk. so the
// spans, definitions, references, rename locations and file-rename edits that
// come back are already addressed to `Foo.utopia` at the right offsets. what
// used to be a hand-rolled offset mapper is now the identity.
export function createPlugin(info: ts.server.PluginCreateInfo): ts.LanguageService {
  const languageService = info.languageService;
  const logger = info.project.projectService.logger;

  const proxy: ts.LanguageService = Object.create(null);

  const source = languageService as unknown as Record<string, Delegate>;
  const target = proxy as unknown as Record<string, Delegate>;

  for (const key of Object.keys(languageService)) {
    const method = source[key];

    target[key] = (...args: unknown[]) => method.apply(languageService, args);
  }

  // the feature this plugin exists for. the language service walks every file in
  // the compilation looking for specifiers that pointed at the moved file, so
  // the components are searched too and their imports come back as edits.
  proxy.getEditsForFileRename = (oldFilePath, newFilePath, formatOptions, preferences) => {
    const changes = languageService.getEditsForFileRename(
      oldFilePath,
      newFilePath,
      formatOptions,
      preferences,
    );

    const components = changes.filter((change) => isUtopiaFile(change.fileName)).length;

    logger.info(
      `[utopia-ts-plugin] rename ${oldFilePath} -> ${newFilePath}: ` +
        `${changes.length} files edited, ${components} of them .utopia`,
    );

    return changes;
  };

  return proxy;
}
