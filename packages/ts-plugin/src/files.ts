import type * as ts from 'typescript';

import { toScriptText, utopiaExtension } from './utopia';

// directories that never hold components and are expensive to walk.
const SCAN_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/ios/**',
  '**/android/**',
  '**/coverage/**',
];

const SCAN_INCLUDES = [`**/*${utopiaExtension()}`];

// a full walk costs tens of milliseconds and the file list is asked for on every
// graph update, so hold it briefly. a component added on disk is picked up on
// the next update after this window.
const SCAN_TTL_MS = 1500;

interface CacheEntry {
  version: string;
  snapshot: ts.IScriptSnapshot;
}

// owns, for one project: which components exist, and the typescript snapshot
// each one currently maps to.
export class UtopiaFiles {
  private readonly entries = new Map<string, CacheEntry>();

  private known: string[] = [];

  private knownAt = 0;

  private scanned = false;

  constructor(
    private readonly typescript: typeof ts,
    private readonly project: ts.server.Project,
  ) {}

  // absolute paths of every .utopia component in the project.
  list(): string[] {
    const now = Date.now();

    // note the guard is the timestamp, not the result: a repository with no
    // components at all must not pay for a walk on every graph update
    if (this.scanned && now - this.knownAt < SCAN_TTL_MS) {
      return this.known;
    }

    const root = this.project.getCurrentDirectory();

    let found: string[];

    try {
      found = this.project.readDirectory(root, [utopiaExtension()], SCAN_EXCLUDES, SCAN_INCLUDES);
    } catch {
      found = this.typescript.sys.readDirectory(
        root,
        [utopiaExtension()],
        SCAN_EXCLUDES,
        SCAN_INCLUDES,
      );
    }

    this.known = found.map((file) => file.replace(/\\/g, '/')).sort();
    this.knownAt = now;
    this.scanned = true;

    return this.known;
  }

  // the snapshot the language service sees for a component, rebuilt only when
  // the host's version for that file moves.
  //
  // the version and the source both come from the unpatched host, which means
  // they come from tsserver's own ScriptInfo: the editor's unsaved buffer when
  // the file is open, the watched disk content when it is not. that is what
  // makes an edit during a session visible, and it is why this cache cannot go
  // stale the way a private one would.
  snapshot(fileName: string, version: string, readSource: () => string): ts.IScriptSnapshot {
    const cached = this.entries.get(fileName);

    if (cached && cached.version === version) {
      return cached.snapshot;
    }

    const snapshot = this.typescript.ScriptSnapshot.fromString(toScriptText(readSource()));

    this.entries.set(fileName, { version, snapshot });

    return snapshot;
  }
}

const stores = new WeakMap<ts.server.Project, UtopiaFiles>();

// one store per project, shared between the create() hook and getExternalFiles.
export function utopiaFilesFor(typescript: typeof ts, project: ts.server.Project): UtopiaFiles {
  let store = stores.get(project);

  if (!store) {
    store = new UtopiaFiles(typescript, project);

    stores.set(project, store);
  }

  return store;
}
