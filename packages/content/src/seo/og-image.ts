import type { OgImageConfig, SeoEntry } from './types.js';

/** Generate an SVG template for an OG image (1200x630) */
export function generateOgSvg(entry: SeoEntry, config?: OgImageConfig): string {
  const bg = config?.background ?? '#000000';
  const fg = config?.textColor ?? '#ffffff';
  const title = entry.title;

  // Word-wrap title to fit within 1200px with ~60px padding each side
  // At font-size 48, roughly 25-30 chars per line
  const maxCharsPerLine = 28;
  const words = title.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxCharsPerLine && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);

  // Limit to 4 lines max
  if (lines.length > 4) {
    lines.length = 4;
    lines[3] = lines[3].slice(0, -3) + '...';
  }

  // Centre the text block vertically
  const lineHeight = 60;
  const totalHeight = lines.length * lineHeight;
  const startY = (630 - totalHeight) / 2 + 48; // +48 for font baseline

  const titleLines = lines
    .map(
      (line, i) =>
        `<text x="600" y="${startY + i * lineHeight}" text-anchor="middle" font-family="monospace" font-size="48" font-weight="700" fill="${fg}">${escapeXmlAttr(line)}</text>`,
    )
    .join('\n    ');

  // M logo top-left
  const logo =
    config?.logo ??
    `<text x="60" y="80" font-family="monospace" font-size="48" font-weight="700" fill="${fg}">M</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${bg}"/>
  ${logo}
  ${titleLines}
  <text x="600" y="580" text-anchor="middle" font-family="monospace" font-size="20" fill="${fg}" opacity="0.6">matthesketh.pro</text>
</svg>`;
}

/** Convert SVG to PNG using a pre-resolved sharp instance */
export async function svgToPng(
  svg: string,
  sharpFn?: (input: Buffer) => {
    resize: (w: number, h: number) => { png: () => { toBuffer: () => Promise<Buffer> } };
  },
): Promise<Buffer | null> {
  if (!sharpFn) return null;
  try {
    return await sharpFn(Buffer.from(svg)).resize(1200, 630).png().toBuffer();
  } catch {
    return null;
  }
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
