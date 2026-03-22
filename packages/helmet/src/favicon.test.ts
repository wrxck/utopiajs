import { describe, it, expect } from 'vitest';
import {
  generateFaviconSvg,
  generateStaticSvg,
  generateMaskSvg,
  generateManifest,
  faviconLinks,
} from './favicon';

// ---------------------------------------------------------------------------
// generateFaviconSvg
// ---------------------------------------------------------------------------

describe('generateFaviconSvg', () => {
  it('produces valid SVG with the given character', () => {
    const svg = generateFaviconSvg('M');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('>M</text>');
  });

  it('includes dark mode media query', () => {
    const svg = generateFaviconSvg('M');
    expect(svg).toContain('prefers-color-scheme: dark');
  });

  it('uses default colors (black on white, inverse for dark)', () => {
    const svg = generateFaviconSvg('M');
    expect(svg).toContain('fill: #ffffff');
    expect(svg).toContain('fill: #000000');
  });

  it('accepts custom colors', () => {
    const svg = generateFaviconSvg('X', { bg: '#ff0000', fg: '#00ff00' });
    expect(svg).toContain('fill: #ff0000');
    expect(svg).toContain('fill: #00ff00');
  });

  it('includes rounded rectangle', () => {
    const svg = generateFaviconSvg('M', { radius: 20 });
    expect(svg).toContain('rx="20"');
    expect(svg).toContain('ry="20"');
  });

  it('uses custom font family', () => {
    const svg = generateFaviconSvg('M', { fontFamily: 'Arial' });
    expect(svg).toContain('font-family="Arial"');
  });

  it('uses default DM Mono font', () => {
    const svg = generateFaviconSvg('M');
    expect(svg).toContain("'DM Mono', monospace");
  });

  it('uses custom size', () => {
    const svg = generateFaviconSvg('M', { size: 200 });
    expect(svg).toContain('viewBox="0 0 200 200"');
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
  });

  it('uses custom font size', () => {
    const svg = generateFaviconSvg('M', { fontSize: 80 });
    expect(svg).toContain('font-size="80"');
  });

  it('centers text with text-anchor and dominant-baseline', () => {
    const svg = generateFaviconSvg('M');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('dominant-baseline="central"');
  });

  it('works with multi-character strings', () => {
    const svg = generateFaviconSvg('MH');
    expect(svg).toContain('>MH</text>');
  });
});

// ---------------------------------------------------------------------------
// generateStaticSvg
// ---------------------------------------------------------------------------

describe('generateStaticSvg', () => {
  it('produces valid SVG without dark mode', () => {
    const svg = generateStaticSvg('M');
    expect(svg).toContain('<svg');
    expect(svg).toContain('>M</text>');
    expect(svg).not.toContain('prefers-color-scheme');
    expect(svg).not.toContain('<style>');
  });

  it('uses inline fill attributes', () => {
    const svg = generateStaticSvg('M', { bg: '#ffffff', fg: '#000000' });
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
  });

  it('defaults to no border radius', () => {
    const svg = generateStaticSvg('M');
    expect(svg).toContain('rx="0"');
  });

  it('accepts custom border radius', () => {
    const svg = generateStaticSvg('M', { radius: 15 });
    expect(svg).toContain('rx="15"');
  });
});

// ---------------------------------------------------------------------------
// generateMaskSvg
// ---------------------------------------------------------------------------

describe('generateMaskSvg', () => {
  it('produces monochrome SVG (no background rect)', () => {
    const svg = generateMaskSvg('M');
    expect(svg).toContain('<svg');
    expect(svg).toContain('>M</text>');
    expect(svg).not.toContain('<rect');
    expect(svg).not.toContain('<style>');
  });

  it('uses black fill for the character', () => {
    const svg = generateMaskSvg('M');
    expect(svg).toContain('fill="#000000"');
  });

  it('accepts custom font family', () => {
    const svg = generateMaskSvg('M', { fontFamily: 'Helvetica' });
    expect(svg).toContain('font-family="Helvetica"');
  });
});

// ---------------------------------------------------------------------------
// generateManifest
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  it('generates a valid manifest with required fields', () => {
    const manifest = generateManifest({ appName: 'My App' });
    expect(manifest.name).toBe('My App');
    expect(manifest.short_name).toBe('My App');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBe(3);
  });

  it('uses custom short name', () => {
    const manifest = generateManifest({ appName: 'My Application', shortName: 'MyApp' });
    expect(manifest.short_name).toBe('MyApp');
  });

  it('uses custom theme and background colors', () => {
    const manifest = generateManifest({
      appName: 'Test',
      themeColor: '#000000',
      backgroundColor: '#111111',
    });
    expect(manifest.theme_color).toBe('#000000');
    expect(manifest.background_color).toBe('#111111');
  });

  it('uses custom icon path prefix', () => {
    const manifest = generateManifest({ appName: 'Test', iconPath: '/assets/icons' });
    expect(manifest.icons[0].src).toBe('/assets/icons/icon-192.png');
    expect(manifest.icons[1].src).toBe('/assets/icons/icon-512.png');
  });

  it('includes maskable icon variant', () => {
    const manifest = generateManifest({ appName: 'Test' });
    const maskable = manifest.icons.find((i) => i.purpose === 'maskable');
    expect(maskable).toBeDefined();
    expect(maskable!.sizes).toBe('512x512');
  });

  it('includes standard 192 and 512 sizes', () => {
    const manifest = generateManifest({ appName: 'Test' });
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('serializes to valid JSON', () => {
    const manifest = generateManifest({ appName: 'Test' });
    const json = JSON.stringify(manifest, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// faviconLinks
// ---------------------------------------------------------------------------

describe('faviconLinks', () => {
  it('returns all required link descriptors with defaults', () => {
    const links = faviconLinks({});
    expect(links.length).toBe(6);
  });

  it('includes SVG favicon link', () => {
    const links = faviconLinks({});
    const svg = links.find((l) => l.rel === 'icon' && l.type === 'image/svg+xml');
    expect(svg).toBeDefined();
    expect(svg!.href).toBe('/favicon.svg');
  });

  it('includes 32x32 and 16x16 PNG favicons', () => {
    const links = faviconLinks({});
    const icon32 = links.find((l) => l.sizes === '32x32');
    const icon16 = links.find((l) => l.sizes === '16x16');
    expect(icon32).toBeDefined();
    expect(icon16).toBeDefined();
  });

  it('includes Apple touch icon', () => {
    const links = faviconLinks({});
    const apple = links.find((l) => l.rel === 'apple-touch-icon');
    expect(apple).toBeDefined();
    expect(apple!.sizes).toBe('180x180');
  });

  it('includes web manifest link', () => {
    const links = faviconLinks({});
    const manifest = links.find((l) => l.rel === 'manifest');
    expect(manifest).toBeDefined();
    expect(manifest!.href).toBe('/site.webmanifest');
  });

  it('includes mask icon with color', () => {
    const links = faviconLinks({});
    const mask = links.find((l) => l.rel === 'mask-icon');
    expect(mask).toBeDefined();
    expect(mask!.color).toBe('#000000');
  });

  it('accepts custom paths', () => {
    const links = faviconLinks({
      svgPath: '/assets/icon.svg',
      appleTouchPath: '/assets/apple.png',
      manifestPath: '/manifest.json',
      maskPath: '/assets/mask.svg',
      maskColor: '#ff0000',
      icon32Path: '/assets/32.png',
      icon16Path: '/assets/16.png',
    });

    const svg = links.find((l) => l.type === 'image/svg+xml');
    expect(svg!.href).toBe('/assets/icon.svg');

    const apple = links.find((l) => l.rel === 'apple-touch-icon');
    expect(apple!.href).toBe('/assets/apple.png');

    const manifest = links.find((l) => l.rel === 'manifest');
    expect(manifest!.href).toBe('/manifest.json');

    const mask = links.find((l) => l.rel === 'mask-icon');
    expect(mask!.href).toBe('/assets/mask.svg');
    expect(mask!.color).toBe('#ff0000');
  });
});
