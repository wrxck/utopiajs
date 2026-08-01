// rule: flag a top-level `effect()` whose callback reads a module-scope
// `const`/`let`/`class` declared BELOW it.
//
// `effect()` invokes its callback immediately on creation to establish the
// initial subscriptions, so a top-level effect that reads a binding declared
// further down the module hits the temporal dead zone and throws a
// ReferenceError while the module is still evaluating. That would be a loud
// failure on its own — but the reactive core reports effect errors rather than
// rethrowing them, and a body that throws before its first signal read captures
// no dependencies, so the effect object survives subscribed to nothing and can
// never be notified again. The feature it drives simply never works, with
// nothing on screen to say so.
//
// deliberately narrow. only top-level `effect(...)` calls; only module-scope
// `const`/`let`/`class` (a `var` is hoisted and a `function` is not in a dead
// zone); and only references that are evaluated as the callback itself runs. a
// reference inside a nested closure — a returned cleanup function, an event
// handler, a setTimeout — is skipped, because that closure does not run at
// registration time and flagging it would be a false positive on an entirely
// ordinary pattern.

import type { AST, Rule, Scope, SourceCode } from 'eslint';

/**
 * An ESTree node as ESLint's own signatures describe it. The `estree` types are
 * not a direct dependency of this package, so the type is named through an API
 * that returns it rather than imported.
 */
type EsNode = ReturnType<SourceCode['getAncestors']>[number];

/** A top-level `effect(...)` call plus the start of the statement holding it. */
interface EffectCall {
  call: EsNode;
  statementStart: number;
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

function startOf(node: EsNode): number {
  return node.range![0];
}

/** The `effect(...)` call in an expression, or null. */
function asEffectCall(node: EsNode | null | undefined): EsNode | null {
  if (!node || node.type !== 'CallExpression') return null;
  const callee = node.callee;
  return callee.type === 'Identifier' && callee.name === 'effect' ? node : null;
}

/**
 * Every top-level `effect(...)`, whether bare (`effect(() => …)`) or bound
 * (`const stop = effect(() => …)`, `export const stop = …`). All of these run
 * during module evaluation, which is what puts a later declaration out of reach.
 */
function topLevelEffectCalls(program: AST.Program): EffectCall[] {
  const out: EffectCall[] = [];

  const visit = (stmt: EsNode, statementStart: number): void => {
    if (stmt.type === 'ExpressionStatement') {
      const call = asEffectCall(stmt.expression);
      if (call) out.push({ call, statementStart });
      return;
    }
    if (stmt.type === 'VariableDeclaration') {
      for (const declarator of stmt.declarations) {
        const call = asEffectCall(declarator.init);
        if (call) out.push({ call, statementStart });
      }
      return;
    }
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
      visit(stmt.declaration, statementStart);
    }
  };

  for (const stmt of program.body) {
    visit(stmt, startOf(stmt));
  }
  return out;
}

/**
 * Where a variable's declaration starts, if reading it before that point is a
 * temporal dead zone error. A `var` (hoisted, initialised undefined), an import
 * (bound before evaluation) and a function declaration are all safe, so they
 * return null.
 */
function deadZoneStart(variable: Scope.Variable): number | null {
  const def = variable.defs[0];
  if (!def) return null;
  if (def.type === 'Variable') {
    return def.parent.kind === 'var' ? null : startOf(def.parent);
  }
  if (def.type === 'ClassName') return startOf(def.node);
  return null;
}

/** The module scope, whichever scope the parser hands back for Program. */
function moduleScopeOf(scope: Scope.Scope): Scope.Scope {
  if (scope.type !== 'global') return scope;
  return scope.childScopes.find((child) => child.type === 'module') ?? scope;
}

/**
 * How many function boundaries sit between a node and the enclosing effect call,
 * or -1 if the node is not inside that call at all.
 *
 * 0 — an argument evaluated at the call site, e.g. `effect(fn, late)`.
 * 1 — the effect callback's own body: it runs immediately, so a read is a hit.
 * 2+ — a closure nested inside the callback: deferred, so not our problem.
 */
function functionDepthWithin(ancestors: EsNode[], call: EsNode): number {
  let depth = 0;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (ancestor === call) return depth;
    if (FUNCTION_TYPES.has(ancestor.type)) depth++;
  }
  return -1;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow a top-level effect() from reading a module-scope const/let declared below it (temporal dead zone)',
      recommended: true,
    },
    schema: [],
    messages: {
      tdz: "effect() runs its callback immediately, but '{{name}}' is declared below it — this throws a ReferenceError while the module evaluates and leaves the effect permanently subscribed to nothing. Move the declaration above the effect.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      'Program:exit'(program: AST.Program): void {
        const effects = topLevelEffectCalls(program);
        if (effects.length === 0) return;

        const scope = moduleScopeOf(sourceCode.getScope(program));

        for (const variable of scope.variables) {
          const declared = deadZoneStart(variable);
          if (declared === null) continue;

          for (const { call, statementStart } of effects) {
            // declared above the effect — fully initialised by the time it runs.
            if (declared <= statementStart) continue;

            for (const reference of variable.references) {
              const identifier = reference.identifier;
              if (identifier.type !== 'Identifier') continue;

              const depth = functionDepthWithin(sourceCode.getAncestors(identifier), call);
              if (depth !== 0 && depth !== 1) continue;

              context.report({
                node: identifier,
                messageId: 'tdz',
                data: { name: variable.name },
              });
            }
          }
        }
      },
    };
  },
};

export default rule;
