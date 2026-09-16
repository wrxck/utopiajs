import { parse } from '@/parser';

export const UTOPIA_EXTENSION = '.utopia';

export function isUtopiaFile(fileName: string): boolean {
  return fileName.endsWith(UTOPIA_EXTENSION);
}

/**
 * The TypeScript view of a component: its `<script>` body, with every other
 * character replaced by a space and every newline kept.
 *
 * Offsets are therefore identical to the original file, so a diagnostic needs
 * no position mapping — its line and column already point into the component.
 * That is the whole reason this blanks rather than extracts.
 *
 * Built on parse() so it cannot disagree with the text the compiler emits. A
 * second regex answering the same question is how an editor ends up checking
 * code that is not the code that ships.
 */
export function toScriptText(source: string, filename = 'anonymous.utopia'): string {
  const script = parse(source, filename).script;
  const blanked = blank(source);
  if (!script || !script.content) return blanked;

  const start = source.indexOf(script.content);
  if (start < 0) return blanked;

  return blanked.slice(0, start) + script.content + blanked.slice(start + script.content.length);
}

function blank(source: string): string {
  let out = '';
  for (const char of source) {
    out += char === '\n' || char === '\r' ? char : ' ';
  }
  return out;
}
