// Ambient types for a UtopiaJS + Vite project. Reference them once, e.g. in
// src/env.d.ts:  /// <reference types="@matthesketh/utopia-vite-plugin/client" />

declare module 'virtual:utopia-routes' {
  import type { Route } from '@matthesketh/utopia-router';
  const routes: Route[];
  export default routes;
  export { routes };
  export const apiManifest: Record<string, () => Promise<Record<string, unknown>>>;
}

declare module '*.utopia' {
  import type { ComponentDefinition } from '@matthesketh/utopia-runtime';
  const component: ComponentDefinition;
  export default component;
}
