// text mapping between a .utopia single-file component and the typescript the
// language service is given for it.
//
// components keep their real path inside the compilation — `Foo.utopia`, not a
// separate virtual name. that matters because tsserver keys its document cache
// on a ScriptInfo per file, and a ScriptInfo can only exist for a path that is
// really on disk. the price is one compiler option (allowNonTsExtensions) and a
// module resolver hook; the reward is that every position, span and file name
// the language service produces is already addressed to the component itself.

const UTOPIA_EXTENSION = '.utopia';
const PROBE_EXTENSION = '.utopia.ts';

export function isUtopiaFile(fileName: string): boolean {
  return fileName.endsWith(UTOPIA_EXTENSION);
}

// `import Foo from './Foo.utopia'` makes typescript's resolver probe for
// `./Foo.utopia.ts`, since .utopia is not an extension it recognises. the
// resolver hook answers that probe and then strips the suffix again, so these
// two helpers are confined to module resolution.
export function isProbePath(fileName: string): boolean {
  return fileName.endsWith(PROBE_EXTENSION);
}

export function fromProbePath(fileName: string): string {
  return fileName.slice(0, -'.ts'.length);
}

export function utopiaExtension(): string {
  return UTOPIA_EXTENSION;
}

// build the typescript text for a component.
//
// the result has exactly the same length as the source: every character outside
// a <script> body is replaced by a space, and newlines are preserved. positions,
// lines and columns therefore map by identity, so an edit the language service
// computes against this text applies to the .utopia file unchanged — there is no
// offset arithmetic anywhere in this package.
export function toScriptText(source: string): string {
  const ranges = scriptBodyRanges(source);
  const out: string[] = new Array(source.length);

  let range = 0;

  for (let index = 0; index < source.length; index += 1) {
    while (range < ranges.length && index >= ranges[range][1]) {
      range += 1;
    }

    const inScript = range < ranges.length && index >= ranges[range][0];
    const char = source[index];

    out[index] = inScript || char === '\n' || char === '\r' ? char : ' ';
  }

  return out.join('');
}

/** Opening tag of a top-level component block. */
const TOP_LEVEL_BLOCK = /<(template|script|style|test)(\s[^>]*)?>/g;

// the body of the component's <script> block — the same block the compiler
// compiles. blocks are scanned in order and each is skipped to its closing
// tag, so a <script> element inside the template (a JSON-LD payload, say) is
// never mistaken for the component script: a regex over every <script> in the
// file type-checked that JSON as typescript. an unclosed block runs to the end
// of the file rather than failing, because the editor sees files mid-edit.
function scriptBodyRanges(source: string): Array<[number, number]> {
  TOP_LEVEL_BLOCK.lastIndex = 0;

  let match = TOP_LEVEL_BLOCK.exec(source);

  while (match !== null) {
    const name = match[1];
    const start = match.index + match[0].length;
    const close = source.indexOf(`</${name}>`, start);
    const end = close === -1 ? source.length : close;

    if (name === 'script') {
      return [[start, end]];
    }

    if (close === -1) break;
    TOP_LEVEL_BLOCK.lastIndex = close + name.length + 3;
    match = TOP_LEVEL_BLOCK.exec(source);
  }

  return [];
}
