// rule: flag a `window` / `document` / `globalThis` `addEventListener` in a
// component that calls `defineProps()`, unless something removes it again.
//
// a `defineProps()` component compiles to a PER-INSTANCE `setup(props)` that the
// runtime calls on every node creation, and unmount only disposes what went
// through `pushDisposer` / `onDestroy`. a bare global listener is therefore
// registered afresh on every mount and never removed: in a real app the same
// screen accumulated 2, 3, 4, 5, 6 listeners over five visits, every one of them
// still firing and still holding its closure alive.
//
// `useEventListener()` from @matthesketh/utopia-runtime registers the disposer
// for you; a manual `removeEventListener` in `onDestroy()` (or in an effect's
// returned cleanup) works just as well.
//
// the pairing check is deliberately generous: ANY `removeEventListener` for the
// same target and event type anywhere in the script clears the report, wherever
// it sits. an author who wrote the removal has thought about teardown, and
// tracing whether a given cleanup path actually runs is not decidable from the
// syntax. that trades a few missed cases for no false positives on correct code.

import type { Rule, SourceCode } from 'eslint';

/**
 * An ESTree node as ESLint's own signatures describe it. The `estree` types are
 * not a direct dependency of this package, so the type is named through an API
 * that returns it rather than imported.
 */
type EsNode = ReturnType<SourceCode['getAncestors']>[number];
type CallNode = Extract<EsNode, { type: 'CallExpression' }>;

/** Globals that outlive every component instance. */
const GLOBAL_TARGETS = new Set(['window', 'document', 'globalThis']);

/** Marks a removal whose event type is not a literal, so it could be any of them. */
const ANY_EVENT = '*';

/** The event type of an addEventListener/removeEventListener call, if it is a literal. */
function literalEventType(arg: EsNode | undefined): string | null {
  if (!arg || arg.type !== 'Literal') return null;
  return typeof arg.value === 'string' ? arg.value : null;
}

/**
 * Whether the options argument already arranges removal: `{ once: true }` fires
 * at most once, and `{ signal }` hands teardown to an AbortController.
 */
function optionsHandleRemoval(arg: EsNode | undefined): boolean {
  if (!arg || arg.type !== 'ObjectExpression') return false;
  for (const property of arg.properties) {
    if (property.type !== 'Property') continue;
    const key = property.key;
    const name =
      key.type === 'Identifier'
        ? key.name
        : key.type === 'Literal' && typeof key.value === 'string'
          ? key.value
          : null;
    if (name === 'signal') return true;
    if (name === 'once' && property.value.type === 'Literal' && property.value.value === true) {
      return true;
    }
  }
  return false;
}

/** `window.addEventListener` and friends — a plain, non-computed global member call. */
function globalListenerCall(node: CallNode): { target: string; method: string } | null {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.computed) return null;
  if (callee.object.type !== 'Identifier' || !GLOBAL_TARGETS.has(callee.object.name)) return null;
  if (callee.property.type !== 'Identifier') return null;
  return { target: callee.object.name, method: callee.property.name };
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow an undisposed global addEventListener in a per-instance (defineProps) component',
      recommended: true,
    },
    schema: [],
    messages: {
      untracked:
        '{{target}}.addEventListener() runs on every mount of this per-instance (defineProps) component and is never removed, so the listeners accumulate. Use useEventListener() from @matthesketh/utopia-runtime, or pair it with {{target}}.removeEventListener() in onDestroy().',
    },
  },
  create(context) {
    let perInstance = false;
    const additions: Array<{ node: CallNode; target: string; event: string | null }> = [];
    /** target → event types that some removeEventListener covers. */
    const removals = new Map<string, Set<string>>();

    return {
      CallExpression(node: CallNode): void {
        if (node.callee.type === 'Identifier' && node.callee.name === 'defineProps') {
          perInstance = true;
          return;
        }

        const call = globalListenerCall(node);
        if (!call) return;
        const event = literalEventType(node.arguments[0]);

        if (call.method === 'addEventListener') {
          if (optionsHandleRemoval(node.arguments[2])) return;
          additions.push({ node, target: call.target, event });
        } else if (call.method === 'removeEventListener') {
          const covered = removals.get(call.target) ?? new Set<string>();
          covered.add(event ?? ANY_EVENT);
          removals.set(call.target, covered);
        }
      },

      'Program:exit'(): void {
        // a module-scope component's setup runs once at import, so a listener
        // there is registered once — untidy, but not the accumulating leak.
        if (!perInstance) return;

        for (const addition of additions) {
          const covered = removals.get(addition.target);
          if (covered) {
            if (covered.has(ANY_EVENT)) continue;
            // a dynamic event type cannot be matched by name; any removal on the
            // same target is taken as the intended pairing.
            if (addition.event === null || covered.has(addition.event)) continue;
          }
          context.report({
            node: addition.node,
            messageId: 'untracked',
            data: { target: addition.target },
          });
        }
      },
    };
  },
};

export default rule;
