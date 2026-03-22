import type { OgImageConfig } from './types.js';

/**
 * DM Mono "M" glyph as an SVG path (no font rendering needed).
 * Geometric approximation: two outer vertical legs, two diagonal inner strokes
 * meeting at a centre point, sized to ~220x300 at origin.
 */
const M_PATH =
  'M0 300 L0 0 L30 0 L110 180 L190 0 L220 0 L220 300 L190 300 L190 50 L115 220 L105 220 L30 50 L30 300 Z';

/** Generate an SVG template for an OG image (1200x630) with a centred "M" glyph */
export function generateOgSvg(_entry?: unknown, config?: OgImageConfig): string {
  const dark = (config?.variant ?? 'dark') === 'dark';
  const bg = dark ? '#000000' : '#ffffff';
  const fg = dark ? '#ffffff' : '#000000';

  // Centre the 220x300 path in the 1200x630 viewport
  const pathW = 220;
  const pathH = 300;
  const tx = (1200 - pathW) / 2; // 490
  const ty = (630 - pathH) / 2; // 165

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${bg}"/>
  <path d="${M_PATH}" transform="translate(${tx},${ty})" fill="${fg}"/>
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
