// ============================================================================
// @matthesketh/utopia-server — SSR runtime
// ============================================================================
//
// Drop-in replacement for @matthesketh/utopia-runtime that builds VNode trees instead of
// real DOM nodes. The same compiled .utopia code runs on both client and
// server — only the runtime import is swapped via a Vite alias.
// ============================================================================

import { batch, computed, createRoot, signal, untrack } from '@matthesketh/utopia-core';

import type { VComment, VElement, VFragment, VNode, VParent, VText } from '@/vnode';

const UPPER_CASE_RE = /([A-Z])/g;

// ---------------------------------------------------------------------------
// attribute safety (mirrors the client runtime's dom.ts guards so ssr output
// never carries a dangerous url or inline event handler)
// ---------------------------------------------------------------------------

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

const JS_SCHEME_RE = /^(?:javascript|vbscript):/i;
const DATA_SCHEME_RE = /^data:/i;
const SAFE_DATA_RE = /^data:(?:image|audio|video|font)\//i;
const URL_TAB_NEWLINE_RE = /[\t\n\r]/g;
// eslint-disable-next-line no-control-regex -- matching C0 controls is the point
const URL_LEADING_C0_RE = /^[\u0000-\u0020]+/;

// the url as the browser's parser reads its scheme: leading c0 controls and
// spaces stripped, every ascii tab/newline deleted (see the runtime's
// urlSchemeView). a raw-string test let `java\tscript:` through.
function urlSchemeView(value: string): string {
  return value.replace(URL_TAB_NEWLINE_RE, '').replace(URL_LEADING_C0_RE, '');
}
const EVENT_ATTR_RE = /^on[a-z]/i;
const NAV_URI_ATTRS = new Set([
  'href',
  'action',
  'formaction',
  'xlink:href',
  'data',
  'ping',
  'cite',
  'background',
  'srcdoc',
]);
const MEDIA_URI_ATTRS = new Set(['src', 'poster']);

function isDangerousUrlValue(attr: string, raw: string): boolean {
  const value = urlSchemeView(raw);
  if (JS_SCHEME_RE.test(value)) return true;
  if (DATA_SCHEME_RE.test(value)) {
    return !(MEDIA_URI_ATTRS.has(attr) && SAFE_DATA_RE.test(value));
  }
  return false;
}

// re-export reactivity primitives (these work identically on the server).
export { batch, computed, createRoot, signal, untrack };

/**
 * Comment data opening a `u-if`/`u-for` range. The client's hydration walker
 * uses it to find which nodes belong to a directive: the compiled code claims
 * the anchor before it renders the branch, so the branch nodes sit between
 * this marker and the anchor. Must match the runtime's RANGE_OPEN.
 */
export const RANGE_OPEN = '[';

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

/**
 * SSR mirror of the runtime's createFragment (compiled output when the
 * compiler's `fragments` option is on). Flattened into the parent VElement
 * at insertion, or serialized as its bare children when it is the root.
 *
 * Children are parented to the fragment immediately — a u-if/u-for anchor
 * inside multi-child slot content must resolve a parent before the fragment
 * is inserted anywhere, exactly as it does on the client where the anchor's
 * parentNode is the DocumentFragment.
 */
export function createFragment(nodes: VNode[]): VFragment {
  const frag: VFragment = { type: 4, children: nodes };
  for (const n of nodes) {
    n._parent = frag;
  }
  return frag;
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

/**
 * Mirror of the runtime's normalizeClass: a string, an object of flags, or an
 * array (nested) of either. The SSR copy used to handle only strings and flat
 * objects, so an array rendered its indices — `class="0 1"`.
 */
export function normalizeClass(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let res = '';
    for (const item of value) {
      const part = normalizeClass(item);
      if (part) res += (res ? ' ' : '') + part;
    }
    return res;
  }
  if (value && typeof value === 'object') {
    let res = '';
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (obj[key]) res += (res ? ' ' : '') + key;
    }
    return res;
  }
  return '';
}

/** Mirror of the runtime's normalizeStyle (arrays merge, later entries win). */
export function normalizeStyle(value: unknown): string | Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const merged: Record<string, unknown> = {};
    for (const item of value) {
      const norm = normalizeStyle(item);
      if (!norm) continue;
      if (typeof norm === 'string') {
        for (const decl of norm.split(';')) {
          const idx = decl.indexOf(':');
          if (idx > 0) merged[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim();
        }
      } else {
        Object.assign(merged, norm);
      }
    }
    return merged;
  }
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return undefined;
}

/** Mirror of the runtime's mergeClass — compiled output imports it. */
export function mergeClass(staticClass: string, value: unknown): string {
  const dynamic = normalizeClass(value);
  if (!dynamic) return staticClass;
  return staticClass ? `${staticClass} ${dynamic}` : dynamic;
}

export function setAttr(el: VElement, name: string, value: unknown): void {
  if (name === 'class') {
    const cls = value == null || value === false ? '' : normalizeClass(value);
    if (cls === '') {
      delete el.attrs['class'];
    } else {
      el.attrs['class'] = cls;
    }
    return;
  }

  if (name === 'style') {
    const normalized = normalizeStyle(value);
    if (normalized == null) {
      delete el.attrs['style'];
    } else if (typeof normalized === 'string') {
      el.attrs['style'] = normalized;
    } else {
      const parts: string[] = [];
      for (const prop of Object.keys(normalized)) {
        if (normalized[prop] != null) {
          const cssName = prop.replace(UPPER_CASE_RE, '-$1').toLowerCase();
          parts.push(`${cssName}: ${normalized[prop]}`);
        }
      }
      el.attrs['style'] = parts.join('; ');
    }
    return;
  }

  // boolean attributes
  if (BOOLEAN_ATTRS.has(name)) {
    if (value) {
      el.attrs[name] = '';
    } else {
      delete el.attrs[name];
    }
    return;
  }

  // generic attributes
  const lower = name.toLowerCase();

  // never serialise an inline event handler from a :bind.
  if (EVENT_ATTR_RE.test(lower)) {
    delete el.attrs[name];
    return;
  }

  // aria-* states are the strings "true"/"false" (see the runtime's setAttr).
  if (typeof value === 'boolean' && lower.startsWith('aria-')) {
    el.attrs[name] = String(value);
    return;
  }

  if (value == null || value === false) {
    delete el.attrs[name];
    return;
  }

  const out = value === true ? '' : String(value);

  // block javascript:/vbscript: (and unsafe data:) urls so a bound value can't
  // round-trip through the html serialiser as a live xss sink.
  if ((NAV_URI_ATTRS.has(lower) || MEDIA_URI_ATTRS.has(lower)) && isDangerousUrlValue(lower, out)) {
    delete el.attrs[name];
    return;
  }

  el.attrs[name] = out;
}

// ---------------------------------------------------------------------------
// Reactive visibility (u-show)
// ---------------------------------------------------------------------------

// server render is a single pass, so we only need the initial state: when the
// element starts hidden, bake `display: none` into its style attr so the markup
// matches what the client shows before hydration. when visible we leave the
// element untouched (its natural display applies).
export function setShow(el: VElement, getter: () => unknown): void {
  if (getter()) return;
  const style = el.attrs['style'];
  el.attrs['style'] = style ? `${style}; display: none` : 'display: none';
}

// ---------------------------------------------------------------------------
// Raw and sanitised HTML (u-html)
// ---------------------------------------------------------------------------

/** Trusted inner HTML (`u-html.raw`) — written verbatim, as on the client. */
export function setHtml(el: VElement, getter: () => unknown): void {
  const value = untrack(getter);
  el.html = value == null ? '' : String(value);
}

let serverSanitizer: ((html: string) => string) | null = null;

/**
 * Install the sanitiser `u-html` (the default, sanitised form) uses during
 * SSR. The browser runtime sanitises with DOMParser, which a server does not
 * have; without a sanitiser the element renders empty on the server and the
 * client fills it in after hydration. Pass `null` to remove it.
 */
export function setServerHtmlSanitizer(fn: ((html: string) => string) | null): void {
  serverSanitizer = fn;
}

/**
 * Sanitised inner HTML (`u-html`). Unsanitised markup must never reach the
 * response, so with no sanitiser installed the element is left empty — the
 * client sanitises and fills it once it hydrates.
 */
export function setSafeHtml(el: VElement, getter: () => unknown): void {
  if (!serverSanitizer) return;
  const value = untrack(getter);
  el.html = serverSanitizer(value == null ? '' : String(value));
}

/**
 * The SSR form of `sanitizeHtml`: runs the installed server sanitiser. Throws
 * when none is installed rather than returning unsanitised markup.
 */
export function sanitizeHtml(html: string): string {
  if (!serverSanitizer) {
    throw new Error(
      '[utopia] sanitizeHtml() has no server implementation; install one with setServerHtmlSanitizer()',
    );
  }
  return serverSanitizer(html);
}

// ---------------------------------------------------------------------------
// Two-way binding (u-model) — the initial state only
// ---------------------------------------------------------------------------

interface ModelSignal {
  (): unknown;
}

/**
 * Render a `u-model` control's initial state: `value` for text-like inputs,
 * `checked` for checkboxes and radios, the text of a `<textarea>`, and the
 * selected option of a `<select>`. There is nothing to listen to on the
 * server; the client wires the events when it hydrates.
 */
export function applyModel(el: VElement, signal: ModelSignal, _opts?: unknown): void {
  const v = untrack(signal);
  const type = (el.attrs['type'] ?? '').toLowerCase();
  const tag = el.tag.toLowerCase();

  if (tag === 'input' && type === 'checkbox') {
    if (v) el.attrs['checked'] = '';
    else delete el.attrs['checked'];
    return;
  }
  if (tag === 'input' && type === 'radio') {
    if (v === (el.attrs['value'] ?? 'on')) el.attrs['checked'] = '';
    else delete el.attrs['checked'];
    return;
  }

  const next = v == null ? '' : String(v);
  if (tag === 'textarea') {
    el.children = next ? [{ type: 2, text: next, _parent: el }] : [];
    return;
  }
  if (tag === 'select') {
    el._modelValue = next;
    return;
  }
  el.attrs['value'] = next;
}

// ---------------------------------------------------------------------------
// Events — no-op on server
// ---------------------------------------------------------------------------

export function addEventListener(
  _el: VElement,
  _event: string,
  // eslint-disable-next-line no-undef -- TS lib.dom type, not a runtime global
  _handler: EventListener,
  // eslint-disable-next-line no-undef -- TS lib.dom type, not a runtime global
  _options?: AddEventListenerOptions,
): () => void {
  return () => {};
}

// ---------------------------------------------------------------------------
// DOM mutations
// ---------------------------------------------------------------------------

export function appendChild(parent: VParent, child: VNode): void {
  // fragments flatten at insertion, mirroring DocumentFragment semantics —
  // the children move into the parent and the fragment empties.
  if (child.type === 4) {
    const moved = child.children;
    child.children = [];
    for (const c of moved) {
      appendChild(parent, c);
    }
    return;
  }
  child._parent = parent;
  parent.children.push(child);
  runPending(child);
}

/** Run a directive anchor's deferred first render now that it has a parent. */
function runPending(node: VNode): void {
  if (node.type === 3 && node._pending) {
    const pending = node._pending;
    node._pending = undefined;
    for (const fn of pending) fn();
  }
}

export function insertBefore(parent: VParent, node: VNode, anchor: VNode | null): void {
  if (node.type === 4) {
    const moved = node.children;
    node.children = [];
    for (const c of moved) {
      insertBefore(parent, c, anchor);
    }
    return;
  }
  node._parent = parent;
  if (anchor === null) {
    parent.children.push(node);
  } else {
    const idx = parent.children.indexOf(anchor);
    if (idx === -1) {
      parent.children.push(node);
    } else {
      parent.children.splice(idx, 0, node);
    }
  }
  runPending(node);
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

// the second parameter mirrors core's EffectOptions so compiled output that
// passes a scheduler type-checks against the SSR shim; on the server an effect
// runs exactly once, so there is nothing to schedule.
export function effect(
  fn: () => void | (() => void),
  _options?: { scheduler?: (run: () => void) => void },
): () => void {
  untrack(() => fn());
  return () => {};
}

export function flushSync<T>(fn: () => T): T {
  return fn();
}

export function createEffect(fn: () => void | (() => void)): () => void {
  return effect(fn);
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

/**
 * Run a directive's first render once its anchor has a parent. An anchor
 * returned as an else-if branch or as a component root has none yet when the
 * directive is created; the client retries on a microtask, and the server —
 * which has no microtask before it serialises — runs it on insertion. Doing
 * nothing here used to drop every `u-else-if`/`u-else` branch and every
 * root-level `u-if`/`u-for` from the server markup.
 */
function whenAnchored(anchor: VComment, render: (parent: VParent) => void): void {
  const run = (): void => {
    const parent = anchor._parent!;
    // open the range the client's hydration walker looks for.
    insertBefore(parent, createComment(RANGE_OPEN), anchor);
    render(parent);
  };
  if (anchor._parent) {
    run();
  } else {
    (anchor._pending ??= []).push(run);
  }
}

export function createIf(
  anchor: VComment,
  condition: () => unknown,
  renderTrue: () => VNode,
  renderFalse?: () => VNode,
): () => void {
  whenAnchored(anchor, (parent) => {
    const truthy = !!untrack(condition);
    if (truthy) {
      const node = untrack(renderTrue);
      insertBefore(parent, node, anchor);
    } else if (renderFalse) {
      const node = untrack(renderFalse);
      insertBefore(parent, node, anchor);
    }
  });

  return () => {};
}

/** Mirrors the runtime's ForItemScope — the row handle compiled templates take. */
export interface ForItemScope<T> {
  track(): void;
  onUpdate(fn: (item: T, index: number) => void): void;
}

export function createFor<T>(
  anchor: VComment,
  list: () => T[],
  renderItem: (item: T, index: number, scope: ForItemScope<T>) => VNode,
  _key?: (item: T, index: number) => string | number,
): () => void {
  whenAnchored(anchor, (parent) => {
    const items = untrack(list);

    // server render is a single pass: no row is ever reused, so nothing
    // rebinds a row's loop variables and nothing needs to observe them. the
    // inert scope is what keeps the markup identical to a first client render
    // — the rows evaluate the same expressions against the same items.
    const scope: ForItemScope<T> = {
      track() {},
      onUpdate() {},
    };

    for (let i = 0; i < items.length; i++) {
      const node = untrack(() => renderItem(items[i], i, scope));
      insertBefore(parent, node, anchor);
    }
  });

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

// ---------------------------------------------------------------------------
// Context (provide / inject) — the same owner chain the client builds
// ---------------------------------------------------------------------------

interface ComponentOwner {
  context: Map<unknown, unknown>;
  parent: ComponentOwner | null;
}

let currentOwner: ComponentOwner | null = null;

export function pushOwner(): ComponentOwner {
  const owner: ComponentOwner = { context: new Map(), parent: currentOwner };
  currentOwner = owner;
  return owner;
}

export function popOwner(owner: ComponentOwner): void {
  currentOwner = owner.parent;
}

/**
 * Server mirror of the runtime's provide(). Without it a component calling
 * provide()/inject() failed to import under SSR, and a server render that got
 * past that resolved every inject() to its fallback.
 */
export function provide(key: unknown, value: unknown): void {
  if (currentOwner) currentOwner.context.set(key, value);
}

export function inject<T = unknown>(key: unknown, fallback?: T): T | undefined {
  let owner = currentOwner;
  while (owner) {
    if (owner.context.has(key)) return owner.context.get(key) as T;
    owner = owner.parent;
  }
  return fallback;
}

/** Run setup + render under a fresh owner, as the client's runSetupAndRender does. */
function setupAndRender(
  Component: ComponentDefinition,
  props: Record<string, unknown>,
  slots: Record<string, () => VNode>,
): VNode {
  const owner = pushOwner();
  try {
    const ctx = Component.setup ? untrack(() => Component.setup!(props)) : {};
    return untrack(() => Component.render({ ...ctx, $slots: slots }));
  } finally {
    popOwner(owner);
  }
}

/**
 * A component whose root is a `u-if`/`u-for` anchor returns it before it has a
 * parent. Give it one — a fragment, which flattens into the real parent on
 * insertion — so the directive renders and the markup keeps its content.
 */
function anchorRoot(el: VNode): VNode {
  if (el.type === 3 && el._pending) {
    const frag: VFragment = { type: 4, children: [] };
    appendChild(frag, el);
    return frag;
  }
  return el;
}

/** A VNode, as opposed to a component definition object. */
function isVNode(value: unknown): value is VNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'number'
  );
}

export function createComponent(
  Component: ComponentDefinition | (() => ComponentDefinition | VNode),
  props?: Record<string, unknown>,
  children?: Record<string, () => VNode>,
): VNode {
  // mirror the client: a function without `render` is a component factory
  // (e.g. `createRouterView`), called for its definition — or for a node,
  // which is used as is. The server used to treat it as a definition and
  // fail with "Component.render is not a function".
  const resolved =
    typeof Component === 'function' && !('render' in Component) ? Component() : Component;
  if (isVNode(resolved)) return resolved;
  const def = resolved as ComponentDefinition;

  const el = anchorRoot(setupAndRender(def, props ?? {}, children ?? {}));

  // Collect scoped styles
  if (def.styles) {
    collectedStyles.add(def.styles);
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
      this.el = anchorRoot(setupAndRender(definition, this.props, this.slots));
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

// lifecycle helpers — no-op on server (no events/timers during ssr). each
// returns a stop function so call sites that capture it stay valid.
export function useEventListener(
  _target: unknown,
  _type: string,
  _handler: unknown,
  _options?: unknown,
): () => void {
  return () => {};
}
export function useInterval(_callback: () => void, _delayMs: number): () => void {
  return () => {};
}
export function useTimeout(_callback: () => void, _delayMs: number): () => void {
  return () => {};
}

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
export function startCapturingLifecycle(): void {}
export function stopCapturingLifecycle(): { mount: (() => void)[]; destroy: (() => void)[] } {
  return { mount: [], destroy: [] };
}

/** Hydration is a browser operation; calling it during SSR is a bug. */
export function hydrate(_component: unknown, _target: unknown): never {
  throw new Error('[utopia] hydrate() cannot run during server rendering');
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
  // On SSR we can't do async, so render the fallback — inside the same
  // container the client builds, so the client's hydration walker can claim
  // it and swap the component in once the module loads.
  return {
    render() {
      const container = createElement('div');
      container.attrs['data-utopia-lazy'] = '';
      if (fallback) appendChild(container, untrack(fallback));
      return container;
    },
  };
}

// ---------------------------------------------------------------------------
// Transitions — no-op on server
// ---------------------------------------------------------------------------

export function createTransition(_el: VNode, _opts: unknown): void {}
export function performEnter(_el: unknown, _hooks: unknown): void {}
/** No animation on the server — a leave completes at once. */
export function performLeave(_el: unknown, _hooks: unknown, done: () => void): void {
  done();
}

// ---------------------------------------------------------------------------
// Scheduler — immediate on server
// ---------------------------------------------------------------------------

/**
 * Rendering on the server is synchronous and the markup is serialised the
 * moment it is built: there is no microtask window before the output is read.
 * So a scheduled job has to run NOW.
 *
 * This used to discard the job entirely, which was silent data loss waiting to
 * happen — anything routed through the scheduler simply never ran during SSR.
 * Nothing did yet, but the DOM bindings do now.
 */
export function queueJob(fn: () => void): void {
  fn();
}
export function nextTick(): Promise<void> {
  return Promise.resolve();
}
export const tick = nextTick;
export const domScheduler = queueJob;

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
