// Ambient types for the content manifest module. Reference them once, e.g. in
// src/env.d.ts:  /// <reference types="@matthesketh/utopia-content/client" />

declare module 'virtual:utopia-content' {
  /** One entry of a collection, as the content Vite plugin serialises it. */
  export interface ContentManifestEntry {
    slug: string;
    data: Record<string, unknown>;
    /** Raw markdown body — present with the plugin's `embedBody` option. */
    body?: string;
    /** Rendered HTML — present with the plugin's `embedHtml` option. */
    html?: string;
  }

  /** Every collection under the content directory, keyed by its folder name. */
  export const collections: Record<string, ContentManifestEntry[]>;
}
