/**
 * @matthesketh/utopia-test — Testing utilities for UtopiaJS components
 *
 * Provides mount(), render(), fireEvent, and nextTick for component testing.
 */

export { fireEvent } from '@/fire-event';
export type { MountOptions, MountResult, RenderResult } from '@/render';
export { mount, render } from '@/render';
export { nextTick } from '@matthesketh/utopia-runtime';
