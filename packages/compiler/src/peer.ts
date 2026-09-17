import { createRequire } from 'node:module';

type PeerRequire = ReturnType<typeof createRequire>;

let peerRequire: PeerRequire | undefined;

// resolving from import.meta.url alone breaks the cjs build: tsup's shim reads
// document.baseURI when a dom is present and hands createRequire an http url.
function resolver(): PeerRequire {
  peerRequire ??= createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
  return peerRequire;
}

/**
 * Load an optional peer dependency.
 *
 * A peer is loaded on the first component that needs it, never at import time,
 * so a project that authors no TypeScript and no Sass never pays for either.
 */
export function requirePeer(id: string): unknown {
  return resolver()(id);
}
