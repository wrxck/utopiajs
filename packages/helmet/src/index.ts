// ============================================================================
// @matthesketh/utopia-helmet — Document head management and favicon generation
// ============================================================================
//
// Manages <head> elements (title, meta, link) and generates adaptive SVG
// favicons with dark mode support. Integrates with UtopiaJS signals for
// reactive head updates.
// ============================================================================

// Types
export type { HeadConfig, MetaDescriptor, LinkDescriptor, FaviconConfig } from './types.js';

export type { ManifestIcon, WebManifest } from './favicon.js';

// Head management
export {
  setTitle,
  setMeta,
  setLink,
  setHtmlLang,
  setHtmlDir,
  setHead,
  useHead,
  resetHead,
} from './head.js';

// Favicon generation
export {
  generateFaviconSvg,
  generateStaticSvg,
  generateMaskSvg,
  generateManifest,
  faviconLinks,
} from './favicon.js';
