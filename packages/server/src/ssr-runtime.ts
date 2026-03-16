// ============================================================================
// @matthesketh/utopia-server — SSR runtime
// ============================================================================
//
// Drop-in replacement for @matthesketh/utopia-runtime that builds VNode trees instead of
// real DOM nodes. The same compiled .utopia code runs on both client and
// server — only the runtime import is swapped via a Vite alias.
// ============================================================================

import { signal, computed, batch, untrack } from '@matthesketh/utopia-core';
import type { VElement, VText, VComment, VNode } from './vnode.js';

const UPPER_CASE_RE = /([A-Z])/g;

// Re-export reactivity primitives (these work identically on the server).
export { signal, computed, batch, untrack };

// ---------------------------------------------------------------------------
// Collected styles — SSR components push their scoped CSS here.
// ---------------------------------------------------------------------------

let collectedStyles = new Set<string>();

/** Reset and return all collected styles (deduplicated). */
export function flushStyles(): string[] {
  const styles = Array.from(collectedStyles);
  collectedStyles = new Set();
  return styles;
}

// ---------------------------------------------------------------------------
// Head management — SSR collects entries during render
// ---------------------------------------------------------------------------

export interface HeadConfig {
  title?: string;
  meta?: { name?: string; property?: string; content: string }[];
  link?: { rel: string; href: string; [key: string]: string }[];
  script?: { src: string; [key: string]: string }[];
}

let collectedHead: HeadConfig[] = [];

export function useHead(config: HeadConfig): void {
  collectedHead.push(config);
}

/** Reset and return all collected head entries. */
export function flushHead(): HeadConfig[] {
  const entries = collectedHead;
  collectedHead = [];
  return entries;
}

// ---------------------------------------------------------------------------
// Node creation
// ---------------------------------------------------------------------------

export function createElement(tag: string): VElement {
  return { type: 1, tag, attrs: {}, children: [] };
}

export function createTextNode(text: string): VText {
  return { type: 2, text: String(text) };
}

export function createComment(text: string): VComment {
  return { type: 3, text };
}

// ---------------------------------------------------------------------------
// Reactive text
// ---------------------------------------------------------------------------

export function setText(node: VText, value: unknown): void {
  node.text = value == null ? '' : String(value);
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export function setAttr(el: VElement, name: string, value: unknown): void {
  if (name === 'class') {
    if (value == null || value === false) {
      delete el.attrs['class'];
    } else if (typeof value === 'string') {
      el.attrs['class'] = value;
    } else if (typeof value === 'object' && value !== null) {
      const classes: string[] = [];
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (obj[key]) classes.push(key);
      }
      el.attrs['class'] = classes.join(' ');
    }
    return;
  }

  if (name === 'style') {
    if (value == null || value === false) {
      delete el.attrs['style'];
    } else if (typeof value === 'string') {
      el.attrs['style'] = value;
    } else if (typeof value === 'object' && value !== null) {
      const parts: string[] = [];
      const styleObj = value as Record<string, unknown>;
      for (const prop of Object.keys(styleObj)) {
        if (styleObj[prop] != null) {
          const cssName = prop.replace(UPPER_CASE_RE, '-$1').toLowerCase();
          parts.push(`${cssName}: ${styleObj[prop]}`);
        }
      }
      el.attrs['style'] = parts.join('; ');
    }
    return;
  }

  // Boolean attributes
  const BOOLEAN_ATTRS = new Set([
    'disabled',
    'checked',
    'readonly',
    'hidden',
    'selected',
    'required',
    'multiple',
    'autofocus',
    'autoplay',
    'controls',
    'loop',
    'muted',
    'open',
    'novalidate',
  ]);

  if (BOOLEAN_ATTRS.has(name)) {
    if (value) {
      el.attrs[name] = '';
    } else {
      delete el.attrs[name];
    }
    return;
  }

  // Generic attributes
  if (value == null || value === false) {
    delete el.attrs[name];
  } else {
    el.attrs[name] = value === true ? '' : String(value);
  }
}

// ---------------------------------------------------------------------------
// Events — no-op on server
// ---------------------------------------------------------------------------

export function addEventListener(
  _el: VElement,
  _event: string,
  _handler: EventListener,
  _options?: AddEventListenerOptions,
): () => void {
  return () => {};
}

// ---------------------------------------------------------------------------
// DOM mutations
// ---------------------------------------------------------------------------

export function appendChild(parent: VElement, child: VNode): void {
  child._parent = parent;
  parent.children.push(child);
}

export function insertBefore(parent: VElement, node: VNode, anchor: VNode | null): void {
  node._parent = parent;
  if (anchor === null) {
    parent.children.push(node);
    return;
  }
  const idx = parent.children.indexOf(anchor);
  if (idx === -1) {
    parent.children.push(node);
  } else {
    parent.children.splice(idx, 0, node);
  }
}

export function removeNode(node: VNode): void {
  if (node._parent) {
    const idx = node._parent.children.indexOf(node);
    if (idx !== -1) {
      node._parent.children.splice(idx, 1);
    }
    node._parent = undefined;
  }
}

// ---------------------------------------------------------------------------
// Effects — SSR runs them once synchronously, without tracking
// ---------------------------------------------------------------------------

export function effect(fn: () => void | (() => void)): () => void {
  untrack(() => fn());
  return () => {};
}

export function createEffect(fn: () => void | (() => void)): () => void {
  return effect(fn);
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

export function createIf(
  anchor: VComment,
  condition: () => unknown,
  renderTrue: () => VNode,
  renderFalse?: () => VNode,
): () => void {
  const parent = anchor._parent;
  if (!parent) return () => {};

  const truthy = !!untrack(condition);

  if (truthy) {
    const node = untrack(renderTrue);
    insertBefore(parent, node, anchor);
  } else if (renderFalse) {
    const node = untrack(renderFalse);
    insertBefore(parent, node, anchor);
  }

  return () => {};
}

export function createFor<T>(
  anchor: VComment,
  list: () => T[],
  renderItem: (item: T, index: number) => VNode,
  _key?: (item: T, index: number) => string | number,
): () => void {
  const parent = anchor._parent;
  if (!parent) return () => {};

  const items = untrack(list);

  for (let i = 0; i < items.length; i++) {
    const node = untrack(() => renderItem(items[i], i));
    insertBefore(parent, node, anchor);
  }

  return () => {};
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ComponentDefinition {
  setup?(props: Record<string, unknown>): Record<string, unknown>;
  render(ctx: Record<string, unknown>): VNode;
  styles?: string;
}

export function createComponent(
  Component: ComponentDefinition,
  props?: Record<string, unknown>,
  children?: Record<string, () => VNode>,
): VNode {
  const ctx = Component.setup ? untrack(() => Component.setup!(props ?? {})) : {};

  const renderCtx: Record<string, unknown> = {
    ...ctx,
    $slots: children ?? {},
  };

  const el = untrack(() => Component.render(renderCtx));

  // Collect scoped styles
  if (Component.styles) {
    collectedStyles.add(Component.styles);
  }

  return el;
}

export function createComponentInstance(
  definition: ComponentDefinition,
  props?: Record<string, unknown>,
) {
  return {
    el: null as VNode | null,
    props: props ?? {},
    slots: {} as Record<string, () => VNode>,
    mount(_target: unknown): void {
      const ctx = definition.setup ? untrack(() => definition.setup!(this.props)) : {};
      const renderCtx: Record<string, unknown> = {
        ...ctx,
        $slots: this.slots,
      };
      this.el = untrack(() => definition.render(renderCtx));
      if (definition.styles) {
        collectedStyles.add(definition.styles);
      }
    },
    unmount(): void {
      this.el = null;
    },
  };
}

export function mount(component: ComponentDefinition, _target: unknown) {
  const instance = createComponentInstance(component);
  instance.mount(null);
  return instance;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks — no-op on server
// ---------------------------------------------------------------------------

export function onMount(_fn: () => void): void {}
export function onDestroy(_fn: () => void): void {}

// ---------------------------------------------------------------------------
// Lifecycle capture — no-op on server
// ---------------------------------------------------------------------------

export function pushDisposer(_fn: () => void): void {}
export function startCapturingDisposers(): null {
  return null;
}
export function stopCapturingDisposers(_prev: unknown): (() => void)[] {
  return [];
}

// ---------------------------------------------------------------------------
// Error boundaries — SSR runs try, falls back on catch
// ---------------------------------------------------------------------------

export function createErrorBoundary(tryFn: () => VNode, catchFn: (error: Error) => VNode): VNode {
  try {
    return untrack(tryFn);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return untrack(() => catchFn(error));
  }
}

// ---------------------------------------------------------------------------
// Lazy components — SSR cannot be async, returns fallback
// ---------------------------------------------------------------------------

export function defineLazy(
  _loader: () => Promise<{ default: ComponentDefinition }>,
  fallback?: () => VNode,
): ComponentDefinition {
  // On SSR we can't do async, so return the fallback or an empty node.
  return {
    render() {
      if (fallback) return untrack(fallback);
      return createComment('lazy');
    },
  };
}

// ---------------------------------------------------------------------------
// Transitions — no-op on server
// ---------------------------------------------------------------------------

export function createTransition(_el: VNode, _opts: unknown): void {}

// ---------------------------------------------------------------------------
// Scheduler — no-op on server
// ---------------------------------------------------------------------------

export function queueJob(_fn: () => void): void {}
export function nextTick(): Promise<void> {
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Form validation — static stubs for SSR
// ---------------------------------------------------------------------------

export type ValidationRule<T = any> = (value: T) => string | null;

export interface FieldConfig<T> {
  initial: T;
  rules?: ValidationRule<T>[];
}

export interface FormField<T> {
  value: () => T;
  set(newValue: T): void;
  error: () => string | null;
  errors: () => string[];
  touched: () => boolean;
  touch(): void;
  dirty: () => boolean;
  valid: () => boolean;
  reset(): void;
}

export interface Form<T extends Record<string, FieldConfig<any>>> {
  fields: { [K in keyof T]: FormField<T[K]['initial']> };
  valid: () => boolean;
  dirty: () => boolean;
  data(): { [K in keyof T]: T[K]['initial'] };
  handleSubmit(onSubmit: (data: { [K in keyof T]: T[K]['initial'] }) => void | Promise<void>): void;
  reset(): void;
}

export function createForm<T extends Record<string, FieldConfig<any>>>(config: T): Form<T> {
  const fields: Record<string, FormField<any>> = {};
  for (const [key, fieldConfig] of Object.entries(config)) {
    const initial = (fieldConfig as FieldConfig<any>).initial;
    fields[key] = {
      value: () => initial,
      set() {},
      error: () => null,
      errors: () => [],
      touched: () => false,
      touch() {},
      dirty: () => false,
      valid: () => true,
      reset() {},
    };
  }
  return {
    fields: fields as Form<T>['fields'],
    valid: () => true,
    dirty: () => false,
    data() {
      const result: Record<string, unknown> = {};
      for (const [key, fieldConfig] of Object.entries(config)) {
        result[key] = (fieldConfig as FieldConfig<any>).initial;
      }
      return result as { [K in keyof T]: T[K]['initial'] };
    },
    handleSubmit() {},
    reset() {},
  };
}

export function required(): ValidationRule {
  return () => null;
}
export function minLength(_n: number): ValidationRule<string> {
  return () => null;
}
export function maxLength(_n: number): ValidationRule<string> {
  return () => null;
}
export function min(_n: number): ValidationRule<number> {
  return () => null;
}
export function max(_n: number): ValidationRule<number> {
  return () => null;
}
export function email(): ValidationRule<string> {
  return () => null;
}
export function pattern(_regex: RegExp): ValidationRule<string> {
  return () => null;
}
export function validate<T>(_predicate: (value: T) => boolean): ValidationRule<T> {
  return () => null;
}
