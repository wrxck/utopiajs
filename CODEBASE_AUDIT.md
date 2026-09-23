# UtopiaJS — Codebase Audit

Branch `audit/codebase-deep-pass`, based on `feat/typescript-in-script`
(0.14.0 plus the TypeScript-in-script work). Audit date 2026-09-22.

## Executive summary

**Scope.** All 16 workspace packages (`core`, `compiler`, `runtime`, `server`,
`router`, `vite-plugin`, `helmet`, `test`, `email`, `content`, `ai`, `cli`,
`create-utopia`, `eslint-plugin-utopia`, `prettier-plugin-utopia`,
`ts-plugin`), the `examples/kitchen-sink` app, the scaffold templates, the docs,
CI and dependency configuration. `packages/database` holds only a stray
`tsconfig.json` on this branch (its sources live on another branch) and was not
audited as a package.

**Method.** Package by package in dependency order, then a cross-package pass.
Every finding below was reproduced with a failing test or probe before it was
fixed; every fix has a regression test that fails against the old code (checked
by swapping the old source back in).

**Result.** 81 confirmed findings — 3 critical, 21 high, 38 medium, 19 low —
all fixed: 58 from the package and cross-package passes, and 23 from five
rounds of adversarial review (10 of them in the base branch's
TypeScript-in-script work, which this PR contains; the fifth round found
nothing new of medium or high confidence). 41 commits, 124 files, about
+7,100 / −955 lines. The test suite grew from 2,018 tests in 71 files to 2,217
in 92 files, all passing.

**Major fixes.**

- Hydration did not work for ordinary templates. Server markup now carries a
  small, documented marker contract and the client claims it node for node.
- Server rendering failed for common templates (`u-model`, `u-html`, a static
  class merged with `:class`), dropped `u-else` branches, and could not render
  a routed app at all. Routed apps now render on the server and hydrate.
- The CLI scaffolded apps that crashed on mount, installed a months-old
  framework release, and could not serve their own API routes.
- Four security defects: a URL-scheme bypass in three sanitisers, API route
  source published in client builds, `javascript:` links from markdown, and an
  MCP handler open to DNS rebinding.

**API additions.** `withRoute`, `compareRouteSpecificity` (router),
`sseResponse` (ai), `emitStyles` (compiler), `setServerHtmlSanitizer`
(ssr-runtime), and published client types
(`@matthesketh/utopia-vite-plugin/client`, `@matthesketh/utopia-content/client`).
No API was removed and nothing was deprecated.

**Compatibility.** Several fixes change observable output (server markup
markers, `aria-*` values, `u-transition` now animating, link interception,
`useHead` merging, the MCP origin check). Each is described with a migration
step in [docs/upgrade-0.15.md](docs/upgrade-0.15.md). The changelog has an
Unreleased entry. The version was not bumped.

**Validation.** Build, lint (0 errors), format check, per-package type checks,
the full test suite and the production dependency audit (0 high/critical after
the override bump) all pass. See [Testing & validation](#testing--validation).

**Decisions taken without asking** (per instruction, each with its
alternatives): the dependency-override bump, the PR base branch, and the
`utopia check` discovery rule. See [Decisions](#decisions-and-alternatives).

## Methodology

1. **Orientation.** Read the READMEs, `llms.md`, `docs/`, the changelog, CI and
   build configuration, and mapped the package dependency graph:
   `core` → `runtime`, `compiler` → `server`, `router` → `vite-plugin`,
   `helmet`, `test`, `email` → `cli`, `create-utopia`; `content` and `ai` stand
   alone; the lint, format and TS plugins sit beside the compiler.
2. **Package pass.** Foundational packages first. For each: public API,
   implementation, tests, then probes for suspected defects. A probe was a
   scratch test run against real compiler output and the real runtime —
   generated code was executed, never judged by eye.
3. **Evidence standard.** A finding counts only when a test reproduced it.
   Suspicions that did not reproduce are listed as such (e.g. `tick()` and
   cascaded flushes).
4. **Triage.** Severity by actual impact: *critical* — a primary feature fails
   for ordinary use; *high* — a security defect or a feature failure with no
   workaround; *medium* — wrong behaviour with a workaround or a narrower
   trigger; *low* — edge cases and hygiene.
5. **Fix.** Root cause, smallest robust change, regression test, verification
   that the test fails on the old code, then the affected suites.
6. **Cross-package pass.** Compiler helpers against both runtimes' exports;
   the server/client markup contract; router/runtime/server integration for
   routed SSR; Vite resolution in server builds; the scaffold and example apps
   against current APIs; docs against implementation.
7. **Adversarial review.** A fresh review of the full diff with the
   code-review tool, then four independent reviewers, until a pass found no
   new medium or high issue (results in [Final review](#final-adversarial-review)).

The machine runs a load guard, so test runs named files explicitly and ran with
reduced workers.

## Findings

IDs follow the audit log. "Test" names the regression test file.

### Critical

**F-17 Hydration fails for ordinary templates** — runtime, server.
*Problem:* adjacent text merged into one DOM node (`Hello {{ name }}!`), an
empty interpolation claimed the next node, and `u-if`/`u-for` anchors were
claimed before the branch or rows the server wrote in front of them. A hydrated
page lost updates, duplicated anchors and rows, and dropped content.
*Expected:* the client claims the server's nodes one for one.
*Evidence:* a round-trip probe (compile → `renderToString` → `hydrate` →
update) failed four out of four templates.
*Root cause:* HTML cannot express adjacent text nodes or a directive's range,
and the compiled code creates an anchor before its branch.
*Fix:* the server writes `<!--|-->` between adjacent text nodes (a separator
where text is due stands for an empty one — see R2-3) and
`<!--[-->` before each directive range; `createComment` claims across the range,
`createIf`/`createFor` claim it on first render, missing nodes are inserted at
the cursor, unclaimed server nodes are removed, a tag mismatch is replaced.
*Test:* `packages/test/src/hydration.test.ts`. *Commit:* bb1bb9c.

**F-31 Every scaffolded router app crashed on mount** — create-utopia.
*Problem:* `App.utopia` wrapped `createRouterView` in
`{ render() { return createRouterView() } }`, returning a definition where a
node is due (`TypeError: parameter 1 is not of type 'Node'`). The smoke test
asserted this shape. *Fix:* import the factory as the component; the smoke test
now asserts the working form, and a new test mounts the real template.
*Test:* `packages/test/src/scaffold-app.test.ts`. *Commit:* 1100967.

**F-24 Routed apps cannot render on the server** — router, server,
vite-plugin. *Problem:* `RouterView` called `document` directly (every server
render threw), there was no way to set the route for a request, and the router
package was externalised from server builds so its runtime import never
reached the SSR swap. *Fix:* `RouterView` builds through the runtime, renders
one pass on the server, and hydrates; `withRoute(routes, url, render)` loads a
route and renders with it current (modules carried on the match, so concurrent
requests stay separate); the plugin bundles `@matthesketh/utopia-*` into server
builds. *Test:* `packages/test/src/ssr-routing.test.ts`,
`routing-hydration.test.ts`. *Commit:* c6040a5.

### High

| ID | Package | Problem | Fix | Test | Commit |
| -- | ------- | ------- | --- | ---- | ------ |
| F-01 | core, runtime | `effect()`/`computed()` created in a component setup never disposed on unmount | setup and render run in a component-owned `createRoot` | `runtime/src/ownership.test.ts` | 95fb815 |
| F-06 | server | SSR runtime lacked `mergeClass`, `applyModel`, `setHtml`, `setSafeHtml` — server render failed for common templates | SSR runtime serves every client runtime value export; parity test | `test/src/hydration.test.ts` | bb1bb9c |
| F-08 | runtime, server, content | URL scheme guards missed `java\tscript:`, `java&#9;script:`, leading C0 characters (XSS past the sanitiser) | normalise as the WHATWG URL parser does before testing | `runtime/src/hardening.test.ts`, `server/src/ssr-runtime.test.ts` | bb1bb9c |
| F-18 | server | `u-else-if`/`u-else` branches and root-level `u-if`/`u-for` missing from server output | render deferred anchors on insertion; fragment root for anchor components | `server/src/ssr-runtime.test.ts` | bb1bb9c |
| F-22 | runtime | `u-transition` did nothing; a leave without CSS transition never completed | hooks on the element; `createIf`/`createFor` play them; safety timeout from CSS time | `runtime/src/transition.test.ts` | cae7350 |
| F-23 | vite-plugin | `+server` API modules globbed into client builds (source published) | server builds only; client gets `{}` | `vite-plugin/src/vite-plugin.test.ts` | 2c4d50a |
| F-32 | create-utopia | deps pinned `^0.7.0` (installs <0.8.0); `vitest ^3` against a `^4` peer | CLI's own version; `vitest ^4` | `create-utopia/src/scaffold.test.ts` | 1100967 |
| F-33 | create-utopia | SSR scaffold could not render routes or serve API routes; AI route used Node `(req, res)` | routed entries, `createHandler` server, fetch-style route | `create-utopia/src/scaffold.test.ts` | 1100967 |
| C-7 | compiler | unfilled `<slot />` compiled to `instanceof Node` — ReferenceError on a real server | shape check (`nodeType` / VNode `type`) | `test/src/ssr-routing.test.ts` | face3dc |
| F-34 | compiler | component CSS never reached server renders; every `.utopia` email unstyled | `emitStyles`, on for server transforms | `email/src/compiled-template.test.ts` | 61f0095 |
| F-35 | runtime | root-level `u-if`/`u-for` inserted after one microtask (every such route page) rendered nothing | render on insertion via the runtime insertion paths | `runtime/src/deferred-anchor.test.ts` | 23a4aab |
| F-36 | content | `renderMarkdown` emitted `javascript:` links and images | rehype step drops unsafe URLs | `content/src/hardening.test.ts` | 1501d23 |
| F-37 | ai | MCP handler checked `Origin` only with an allow-list (DNS rebinding) | validate by default (loopback + `corsOrigin`) | `ai/src/mcp/hardening.test.ts` | 47abf6c |
| F-38 | create-utopia | blog pages imported filesystem APIs into the browser; post page showed the first slug forever | build-time manifest + `getRouteParam` | `test/src/scaffold-app.test.ts` | d12d97c |

### Medium

| ID | Package | Problem | Fix | Commit |
| -- | ------- | ------- | --- | ------ |
| F-02 | core | effect re-run registered nested effects with an unrelated `createRoot` | effects/computeds re-run under their own root | df5e195 |
| F-03 | core | computed recomputing to an equal value re-ran dependants | epoch-based change check before running | df5e195 |
| F-07 | server | SSR class/style arrays rendered `"0 1"` | mirrored `normalizeClass`/`normalizeStyle` | bb1bb9c |
| F-09 | runtime, server | `aria-*` `false` removed, `true` rendered `""` | `"true"`/`"false"` | bb1bb9c, cae7350 |
| F-10 | runtime | lazy components dropped props and slots | forward through setup | bb1bb9c |
| F-11 | runtime | lazy component mounted after its scope was disposed | disposed flag | bb1bb9c |
| F-19 | server | SSR `provide`/`inject` missing | owner chain on the server | bb1bb9c |
| F-20 | runtime | hydration adopted an element with a different tag | tag check, replace | bb1bb9c |
| F-21 | runtime, server | lazy components never hydrated (detached container) | shared container markup, hydration-aware | bb1bb9c |
| F-25 | router | `defineProps` layouts got empty `$slots` — blank page | forward slots; page as default slot in DOM order | c6040a5 |
| F-26 | server | SSR `createComponent` rejected component factories | resolve like the client | c6040a5 |
| F-27 | vite-plugin | `client.d.ts` never published | `files` + `./client` export | c6040a5 |
| F-28 | server | API responses: one `Set-Cookie`, corrupted binary, buffered SSE, HEAD body | stream bytes, all cookies | e9ae8d2 |
| F-29 | server | API routes in glob order — `[id]` shadowed static | specificity sort; HEAD→GET | e9ae8d2 |
| F-30 | ai | no fetch-style SSE helper for API routes | `sseResponse` | d305f58 |
| C-1 | compiler | static attribute entities not decoded | decode | face3dc |
| C-2 | compiler | `u-else` in multi-child slot content rendered unconditionally | slot content through `genChildren` | face3dc |
| C-9 | compiler | scoped CSS split `:is()`/`:where()` lists and quoted values | top-level split and placement | 7b8a11a |
| R-1 | router | older navigation with a slow guard committed after a newer one | navigation token | 6b4eb48 |
| R-2 | router | relative links (`?page=2`) reloaded the page | resolve like the browser; unmatched links to the browser | 6b4eb48 |
| R-3 | router | hash-only back/forward remounted the page | keep the route | 6b4eb48 |
| H-1 | helmet | `useHead` callers erased each other's tags | merged entries | 7ba045f |
| M-1 | content | MCP `create_entry` could write `.utopia` source | enforce formats | bd5e5d1 |
| T-1 | test | `<test>` plugin overwrote and deleted a hand-written test file | header check | 209d10c |
| E-1 | examples | kitchen sink: `^0.2.0` deps, TS in plain scripts, no router in SSR, Node-style API routes | rewritten to current APIs | e73bed6 |

### Low

| ID | Package | Problem | Commit |
| -- | ------- | ------- | ------ |
| F-04 | core | self-disposing effect leaked re-subscriptions and dropped its returned cleanup | df5e195 |
| F-05 | runtime | a throwing setup/render dropped its captured disposers undisposed | 95fb815 |
| F-12 | runtime | error boundary cleanup not forwarded to the parent scope | 95fb815 |
| F-13 | core | a throwing scheduled job dropped the rest of the queue | df5e195 |
| F-15 | core | `persistedSignal` threw when storage access was blocked | df5e195 |
| C-3/C-8 | compiler | `@click="obj.method"` lost `this`; `$event` replaced inside identifiers | face3dc |
| C-4/C-5/C-6 | compiler | `<slot>` fallback discarded; raw duration modifier in code; `href=/x` parse error | face3dc |
| V-1 | vite-plugin | `defineConfig` discarded user `ssr` options | 47d8195 |
| X-1 | cli, ts-plugin, eslint-plugin, compiler | fractional ports, string JSON-RPC codes, template `<script>` type-checked, stale plugin meta version, script offset lookup | a298c76, c0b55ed, ef73330, 7b8a11a |

## Refactoring

- **Reactive roots** (core). Root disposers moved from an array to a `Set`, and
  effects/computeds remove themselves when disposed individually. *Problem:* a
  long-lived root accumulated closures for every branch toggle. *Compatibility:*
  internal.
- **Component setup inside a root** (runtime). `runSetupAndRender` now owns a
  `createRoot`. The router's own page rendering keeps its separate root (see
  remaining concerns).
- **Hydration walker** (runtime). Cursor state gained a parent and an end
  boundary, and range helpers (`beginRange`/`settleRange`/`endRange`).
  Internal.
- **Deferred anchor renders** (runtime, new `pending.ts`). One registry
  replaces a single-microtask retry. Internal.
- **Slot content generation** (compiler). One `genContentFactory` serves
  component slot content and `<slot>` fallback content.

## API improvements

| API | Old usage | New usage | Compatibility |
| --- | --------- | --------- | ------------- |
| `withRoute(routes, url, render)` | none — routed SSR impossible | `withRoute(routes, url, () => renderToString(App))` | additive |
| `sseResponse(stream)` | `streamSSE(res, …)` needs a Node response | `return sseResponse(ai.stream(…))` in an API route | additive; `streamSSE` unchanged |
| `compile(src, { emitStyles })` | CSS only via the bundler | CSS on the definition | additive, default off |
| `setServerHtmlSanitizer(fn)` | sanitised `u-html` failed on the server | install any sanitiser | additive |
| `@matthesketh/utopia-vite-plugin/client`, `@matthesketh/utopia-content/client` | unpublished / none | `/// <reference types=…>` | additive |
| `compareRouteSpecificity` | internal | exported | additive |

No deprecations. See [docs/upgrade-0.15.md](docs/upgrade-0.15.md).

## Cross-package findings

Found only by looking across package boundaries: F-06 and F-26 (compiler
output vs. SSR runtime exports), F-17 (compiler anchor order vs. serializer vs.
hydration walker), F-24 (router vs. Vite server resolution), F-34 (compiler vs.
Vite vs. email), F-31/F-32/F-33/F-38 (CLI templates vs. current APIs and peer
ranges), F-30 (AI docs vs. server API route contract), E-1 (example vs. every
package). Two parity tests now guard these seams: SSR runtime exports ⊇ client
runtime exports, and every example and template component compiles.

## Compiler / runtime / SSR / hydration summary

The compiled output is the contract between four parts. Before this audit, each
part was tested on its own and the joins were not:

- compiler ↔ SSR runtime: four helpers missing (F-06), factories rejected
  (F-26), `instanceof Node` in slots (C-7), deferred anchors dropped (F-18).
- serializer ↔ hydration walker: no way to express text boundaries or ranges
  (F-17).
- compiler ↔ Vite ↔ server: component CSS lost (F-34).
- runtime ↔ router: late insertion (F-35), layout render order (F-25).

The new tests in `packages/test` compile real templates and run them through
both runtimes, the serializer and the walker.

## Defensive security findings

| ID | Issue | Impact | Fix |
| -- | ----- | ------ | --- |
| F-08 | URL scheme bypass (tab/newline/C0) in `setAttr`, `sanitizeHtml`, SSR `setAttr`, content prerender | stored/reflected XSS through bound URLs and sanitised HTML | parse-equivalent normalisation |
| F-23 | API route source in client builds | disclosure of server code and anything hard-coded in it | server-only glob |
| F-36 | `javascript:` URLs from markdown | XSS where markdown HTML is rendered raw | rehype URL filter |
| F-37 | MCP handler without origin check by default | DNS rebinding reaches local tool execution | default origin validation |
| M-1 | MCP could write component source | content writer (incl. AI agents) can plant code | format enforcement |
| D-1 | js-yaml, sharp advisories (high) | DoS / libheif bugs in content dependencies | override floors raised |

Not changed (documented): binding `srcdoc` is an HTML sink like `u-html`;
`createMCPHandler` still serves callers without `authorize` (it now warns).

## Performance findings

- **Equal computed values stop propagation** (F-03). An effect behind
  `computed(() => Math.floor(offset() / 10))` ran on every `offset` change; it
  now runs once per page. The check is allocation-free (epoch counters).
- **Root disposer accumulation** removed (see refactoring).
- No speculative micro-optimisation was made. Hydration adds one comment per
  directive and per text boundary to server output; the walker work stays
  linear.

## Dependency changes

| Package | Previous | New | Reason | Validation |
| ------- | -------- | --- | ------ | ---------- |
| js-yaml (override) | `>=3.15.1 <4` | `>=3.15.2 <4` | GHSA-2883-xcg3-v3hh (high); 3.15.2 published 2026-08-26 | content suite, audit |
| sharp (override) | `>=0.35.0` | `>=0.35.4` | GHSA-g89c-p67h-r497 (high); 0.35.4 published 2026-08-26 | content suite, audit |
| `@matthesketh/utopia-test` devDeps | — | core, router, server (`workspace:*`) | its tests import them undeclared | package type check |
| scaffold template | `^0.7.0`, `vitest ^3` | CLI version, `vitest ^4` | stale pins, peer conflict | scaffold tests |
| kitchen sink | `^0.2.0` | `^0.14.0` | stale pins | compile check |

**Decision taken without asking (per instruction).** For the two advisories,
the options were (a) raise the override floors — chosen; (b) leave them and
keep CI's audit step red; (c) upgrade `gray-matter` / drop `sharp`. Option (a)
is patch-level and matches the repository's existing pattern.

## Testing & validation

| Command | Result |
| ------- | ------ |
| `pnpm build` | passed (run before the review rounds; re-run at the end) |
| `pnpm lint` | passed — 0 errors, 19 pre-existing `no-explicit-any` warnings |
| `pnpm format:check` | passed |
| `tsc -p packages/<pkg>/tsconfig.json --noEmit` for core, runtime, server, router, compiler, vite-plugin, helmet, content, ai, create-utopia, test, ts-plugin | passed (the compiler's test file imports the runtime undeclared — pre-existing, listed below) |
| full test suite over all 92 test files (explicit paths, 4 workers) | passed — 2,217 tests; an intermediate run had 2 timeouts under load 18 in the TypeScript `check` tests, fixed with a 30 s timeout for those files |
| `pnpm audit --prod --audit-level=high` | failed before (2 high, pre-existing on `main`), fixed; 4 moderate and 1 low remain in dev tooling |
| every example and template `.utopia` compiled and parsed | 12/12 after fixes (2 failed before) |
| regression tests against the old source | every new test fails on the code before its fix |
| `tsconfig.check.json` whole-repo check | unavailable — it cannot resolve the per-package `@/` alias (pre-existing) |

## Migration / upgrade guide

See [docs/upgrade-0.15.md](docs/upgrade-0.15.md). In short: upgrade all
packages together; update exact-HTML server snapshots; review `aria-*`
selectors; remove `u-transition` where no animation is wanted; add a catch-all
route if you relied on the client 404 view for unknown links; configure
`allowedOrigins`/`corsOrigin` for browser MCP clients; rewrite Node-style API
routes as fetch-style.

## Remaining concerns

| Concern | Evidence | Confidence | Why unresolved | Recommendation |
| ------- | -------- | ---------- | -------------- | -------------- |
| `data-*` with `null`: client writes `""`, server removes it | conflicting tests in both packages | high | the intended contract is undecided; hydration corrects it | decide, then align one side |
| Layouts remount on every navigation, even when shared | reading of `RouterView` | high | design change, beyond a fix | keep layouts mounted across routes that share them |
| Code-split route CSS is not preloaded for SSR pages | Vite links only entry CSS | medium | needs the SSR manifest | inject route CSS links from the manifest |
| Runtime `useHead` appends duplicates of server head tags on hydration | reading of `head.ts` | medium | needs a claim or dedupe strategy | tag server head entries and adopt them |
| Nested effects are not owned by their parent effect | by design, documented | high | changing it breaks existing patterns | keep documented |
| `fragments` option unsupported with hydration | documented warning | high | out of scope | extend the range contract to fragment roots |
| Router renders pages with its own setup/render path | `components.ts` duplicates `runSetupAndRender` | high | semantics differ (module-scope pages get props) | unify behind one runtime helper |
| Prettier plugin formats templates with the HTML parser | `{{ a<b }}` would parse as a tag | low | tooling edge | use a template-aware parser |
| `packages/database/tsconfig.json` is a stray file | only file on this branch | high | sources live on another branch; deleting could conflict | remove when that branch lands or is dropped |
| No type-check step in CI; `tsconfig.check.json` broken | see validation | high | CI change deserves its own PR | add per-package `tsc --noEmit` |
| Compiler test imports the runtime without declaring it | `tsc` error | high | trivial but unrelated | add a dev dependency |
| Hand-built raw `DocumentFragment` list rows whose first root is a deferred `u-if` anchor come out misordered | round-4 reviewer repro; old and new code alike | high | compiled output never builds such rows; only hand-written `renderItem`s do | re-snapshot fragment roots after deferred renders |
| `currentRoute().url.hash` stays stale after a hash-only back/forward | round-2 note | high | updating it would remount the page (RouterView compares matches by identity) | compare matches by route and params instead of identity |
| `utopia check` runs a second program to find type-only imports (~55% slower) | round-3 measurement | high | the cost buys a real runtime-failure check | make it opt-out if large projects object |
| A signal write made from inside an effect's own run (e.g. a branch render appending to its list) is dropped | round-5 repro; pre-existing (the old `_queued` guard dropped it too) | high | changing re-entrancy semantics is a design decision | re-queue an effect whose source changes mid-run, with the flush guard as the loop bound |
| `utopia check` warns about `.utopia` files under `dist/` when no `outDir`/exclude covers it | round-5 note | medium | rare; the template excludes `dist` | add `dist` to the unreached walk's exclude |
| `tick()` resolving before a cascaded flush | probe did not reproduce | low | not reproduced | none |

## Files changed

- **core** — `index.ts`, `scheduler.ts`, `persisted.ts`, `shared.ts` (doc); tests `ownership`, `scheduler`, `persisted`.
- **runtime** — `component.ts`, `directives.ts`, `dom.ts`, `hydration.ts`, `lazy.ts`, `error-boundary.ts`, `transition.ts`, new `pending.ts`; tests `ownership`, `transition`, `deferred-anchor`, `hardening`, `runtime`.
- **server** — `ssr-runtime.ts`, `render-to-string.ts`, `render-to-stream.ts`, `html-utils.ts`, `vnode.ts`, `handler.ts`, `api-handler.ts`; tests updated and extended.
- **compiler** — `template-compiler.ts`, `style-compiler.ts`, `script-text.ts`, `index.ts`; tests.
- **router** — `components.ts`, `router.ts`, `matcher.ts`, `index.ts`; new `navigation.test.ts`.
- **vite-plugin** — `index.ts`, `client.d.ts`, `package.json`; tests.
- **helmet** — `head.ts`; new `use-head`, `ssr` tests.
- **content** — `markdown.ts`, `mcp/tools.ts`, `adapters/filesystem.ts`, `seo/prerender.ts`, new `client.d.ts`; tests.
- **ai** — `streaming.ts`, `mcp/handler.ts`, `index.ts`; tests.
- **email** — new `compiled-template.test.ts`.
- **test** — `vitest-plugin.ts`, `package.json`; new `hydration`, `ssr-routing`, `routing-hydration`, `compiled-templates`, `scaffold-app` tests and `fixtures/routing.ts`.
- **cli, ts-plugin, eslint-plugin** — small fixes, new ts-plugin tests.
- **create-utopia** — `src/index.ts`, template `App.utopia`, `server.js`, `package.json`, new `env.d.ts`; tests.
- **examples/kitchen-sink** — entries, server, API routes, three pages, new email template.
- **docs** — `ssr.md`, `architecture.md`, new `upgrade-0.15.md`, `llms.md`, `README.md`, package READMEs, `CHANGELOG.md`, this report.
- **root** — `package.json` overrides, `pnpm-lock.yaml`.

## Final adversarial review

Five review rounds ran against the finished diff. Each finding was reproduced
with a scratch test before it was fixed, and each fix has a regression test that
fails on the code before it.

**Round 1** (code-review tool, high effort). It reviewed the base branch's
TypeScript-in-script commits (`main..feat/typescript-in-script`), which this
PR carries. 10 findings, all fixed in 4196223:

| # | Severity | Finding | Fix |
| - | -------- | ------- | --- |
| R1-1 | high | a type imported without `type` compiles to a runtime import of a missing export | `utopia check` reports it (TS1484/1485) through a verbatimModuleSyntax pass |
| R1-2 | high | plain-JS components checked as strict TypeScript | checked only under `checkJs`, like `.js` |
| R1-3 | medium | template-only bindings reported unused under `noUnusedLocals` | dropped when the template names the binding |
| R1-4 | high | tsconfig errors dropped — a broken config checked as clean | config, option and global diagnostics collected |
| R1-5 | medium | an emoji moved every later diagnostic line | blank by UTF-16 unit |
| R1-6 | medium | compiler version committed as `0.14.1-local.3` | back to 0.14.0 |
| R1-7 | medium | module resolution dropped per-import mode and cache | both passed |
| R1-8 | medium | a malformed component crashed the check | reported as a diagnostic |
| R1-9 | medium | discovery hard-coded to `src/`, ignoring include/exclude | tsconfig include/exclude with the `.utopia` extension |
| R1-10 | medium | `typescript` resolved from the CLI, not the project | project first, CLI fallback |

Also fixed: the compile error named a directory, and the check wrote colour
codes into pipes.

**Round 2** (independent reviewer on `feat/typescript-in-script..HEAD`).
Verdict "reject" with 7 reproduced defects, all fixed:

| # | Severity | Finding | Fix | Commit |
| - | -------- | ------- | --- | ------ |
| R2-1 | high | a streamed API body failing after headers → unhandled rejection, hung client | destroy the response | 1a1b4bd |
| R2-2 | high | MCP `update_entry` could overwrite `.utopia` source (bypassed M-1) | update, publish and delete refuse it | 61a1d3f |
| R2-3 | high | an empty interpolation claimed the following static text on hydration | separator between every adjacent text pair; separator stands for empty text | 2cc75d6 |
| R2-4 | medium | root-level `u-if` rendered twice when inserted synchronously | microtask retry only if the insertion hook did not run | 2cc75d6 |
| R2-5 | medium | rows rooted at a `u-if` hydrated and reordered out of order | directive ranges move as a unit | 2cc75d6 |
| R2-6 | medium | `<textarea>`/`<title>` text duplicated on hydration | raw-text content rebuilt | 2cc75d6 |
| R2-7 | low | relative links ignored `<base href>` | resolve against `document.baseURI` | 63470e8 |

The reviewer also noted that the upgrade guide's catch-all advice undid the new
link rule; the guide now says so (4c2aece).

**Round 3** (independent reviewer on the round-2 fixes). 1 high, 3 low, all
fixed in 599aa0b:

| # | Severity | Finding | Fix |
| - | -------- | ------- | --- |
| R3-1 | high | the scaffold tsconfig (`src/**/*.ts`) made `utopia check` skip route pages and report clean | template includes `src/**/*`; CLI warns about unchecked components |
| R3-2 | low | nested ranges listed repeatedly (exponential in depth) | single expansion; anchor rows also render on insertion, not a microtask later |
| R3-3 | low | `<iframe>` text duplicated on hydration | client and server raw-text lists match |
| R3-4 | info | the verbatimModuleSyntax pass adds ~55% to check time | kept; documented below |

Round 3 ruled out, among others: email output with the new separators
(`htmlToText` strips them; the inliner is unaffected), leaks in the range map,
the retry guard, base-URI resolution, the MCP guard across all tools, and the
stream error path.

<a id="round-4"></a>**Round 4** (independent reviewer on the round-3 fixes). 3 medium, all
fixed:

| # | Severity | Finding | Fix |
| - | -------- | ------- | --- |
| R4-1 | medium | a throwing branch of a `u-if`-rooted row, now rendered inside the reconcile loop, stranded rows and swallowed the error | such rows render after the pass commits `entries` |
| R4-2 | medium | those renders ran inside the list effect and subscribed it to what the branch read | rendered under `untrack` |
| R4-3 | medium | the CLI "not checked" warning ignored the tsconfig `exclude`, double-counted symlinks and fired on broken configs | `check()` computes `unreached` with the config's own exclude and real paths, empty on config errors |

Round 4 ruled out double renders, keyed reorders of anchor rows, transitions,
the hydration first pass and fragment rows. It noted one pre-existing
limitation (a hand-built raw `DocumentFragment` row whose first root is a
deferred anchor), which compiled output cannot produce; it is listed under
remaining concerns.

**Round 5** (independent reviewer on the round-4 fixes) found **no medium or
high-confidence regression**. It checked keyed reorders, nested lists and
toggles of anchor rows against the parent commit, the `untrack` scope, and the
`unreached` computation with `extends`, symlinks, `node_modules`, `files`-only
and solution configs. Its three low notes: `dist/` is skipped only through the
default excludes (listed below); a list write made from inside a branch render
is dropped (pre-existing, listed below); and one test did not assert that the
error surfaces — now strengthened.

This closes the review loop: the last complete pass produced no new high- or
medium-confidence actionable finding.

## Decisions and alternatives

| Decision | Chosen | Alternatives |
| -------- | ------ | ------------ |
| Dependency advisories (js-yaml, sharp) | raise the existing override floors to the patched versions | leave CI red; replace gray-matter / drop the sharp peer |
| PR base | branch from `feat/typescript-in-script`, so the audit covers that work | branch from `main` and exclude it; commit onto the feature branch |
| `utopia check` discovery | tsconfig include/exclude, plus a warning for any component left out | keep the `src/` walk (misses other layouts, ignores exclude); check every `.utopia` under the config dir (ignores the user's exclude) |
| Check cost of the type-only-import pass | keep the second program (~55% slower, catches a runtime failure) | drop it and document `import type`; make it opt-in |
| Hydration of empty text | separator comments between every text pair | a dedicated empty-text marker; always emit a placeholder text node |
