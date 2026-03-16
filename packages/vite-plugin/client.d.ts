declare module 'virtual:utopia-routes' {
  import type { Route } from '@matthesketh/utopia-router';
  const routes: Route[];
  export default routes;
  export { routes };
  export const apiManifest: Record<string, () => Promise<Record<string, unknown>>>;
}
