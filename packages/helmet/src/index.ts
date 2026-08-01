// ============================================================================
// @matthesketh/utopia-helmet — Document head management and favicon generation
// ============================================================================
//
// Manages <head> elements (title, meta, link) and generates adaptive SVG
// favicons with dark mode support. Integrates with UtopiaJS signals for
// reactive head updates.
// ============================================================================

// Types
export type { ManifestIcon, WebManifest } from '@/favicon';
export type { FaviconConfig, HeadConfig, LinkDescriptor, MetaDescriptor } from '@/types';

// Head management
export {
  resetHead,
  setHead,
  setHtmlDir,
  setHtmlLang,
  setLink,
  setMeta,
  setTitle,
  useHead,
} from '@/head';

// Favicon generation
export {
  faviconLinks,
  generateFaviconSvg,
  generateManifest,
  generateMaskSvg,
  generateStaticSvg,
} from '@/favicon';
