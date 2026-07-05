import { definePlugin, type FileContext, type Node, walk } from "@omnimod/core";
import {
  type ArrowFunctionExpression,
  cast,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type Identifier,
  type ImportDeclaration,
  type ImportSpecifier,
  type MemberExpression,
} from "@omnimod/plugin-utils";

export type ReduxToToolkitOptions = Record<string, unknown>;

const RTK_MODULE = "@reduxjs/toolkit";
const REDUX_MODULE = "redux";

// Names that `@reduxjs/toolkit` re-exports verbatim from `redux`, so the only
// change needed is the import source.
const RTK_REEXPORTED = new Set([
  "combineReducers",
  "compose",
  "bindActionCreators",
  "applyMiddleware",
]);

// `createStore` / `legacy_createStore` become `configureStore` (name + source).
const STORE_CREATORS = new Set(["createStore", "legacy_createStore"]);

interface ReduxImport {
  node: ImportDeclaration;
  /** imported name → local name, for named specifiers only. */
  named: Map<string, string>;
  /** True if the declaration has a default/namespace specifier we cannot split. */
  hasNonNamed: boolean;
}

/**
 * Migrate legacy Redux to Redux Toolkit. Rewrites `redux` imports to
 * `@reduxjs/toolkit` (re-exported helpers) and `createStore`/`legacy_createStore`
 * to `configureStore`, rewriting `createStore(rootReducer[, preloadedState])`
 * call sites into `configureStore({ reducer, preloadedState })`. Semantic
 * migrations (switch reducers, `connect`, action creators, saga/thunk) are left
 * untouched with a `warn` diagnostic and a `// TODO(omnimod)` breadcrumb.
 */
export const reduxToToolkit = definePlugin<ReduxToToolkitOptions>({
  name: "redux-to-toolkit",
  description: "Migrate legacy Redux to Redux Toolkit.",
  include: ["**/*.{ts,tsx,js,jsx,mts,cts}"],

  transform(file: FileContext): void {
    const reduxImport = findReduxImport(file);

    // Local names bound to createStore/legacy_createStore, so we can find call sites.
    const storeCreatorLocals = new Set<string>();
    if (reduxImport) {
      for (const [imported, local] of reduxImport.named) {
        if (STORE_CREATORS.has(imported)) storeCreatorLocals.add(local);
      }
      rewriteReduxImport(file, reduxImport);
    }

    // Rewrite createStore(...) call sites (only those bound to the redux import).
    if (storeCreatorLocals.size > 0) {
      rewriteStoreCalls(file, storeCreatorLocals);
    }

    // Semantic warnings (report + TODO, never mutate the construct itself).
    reportSemanticFollowups(file);
  },
});

/** Find the first `import ... from "redux"` declaration in the file. */
function findReduxImport(file: FileContext): ReduxImport | null {
  for (const stmt of file.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const imp = cast<ImportDeclaration>(stmt);
    if (imp.source.value !== REDUX_MODULE) continue;

    const named = new Map<string, string>();
    let hasNonNamed = false;
    for (const spec of imp.specifiers) {
      if (spec.type === "ImportSpecifier") {
        const s = cast<ImportSpecifier>(spec);
        const imported =
          s.imported.type === "Identifier" ? cast<Identifier>(s.imported).name : null;
        if (imported === null) {
          hasNonNamed = true;
          continue;
        }
        named.set(imported, s.local.name);
      } else {
        // ImportDefaultSpecifier / ImportNamespaceSpecifier: `redux` has no default,
        // but be conservative and don't try to split those.
        hasNonNamed = true;
      }
    }
    return { node: imp, named, hasNonNamed };
  }
  return null;
}

/**
 * Rewrite the `redux` import to `@reduxjs/toolkit`. Every named specifier we care
 * about (re-exported helpers + store creators) is available from RTK, so in the
 * common all-named case we just retarget the source and swap store-creator names.
 * If any specifier is unknown (some other redux export) or the declaration has a
 * default/namespace binding, we split: known names move to a new RTK import and
 * the original `redux` import keeps the rest.
 */
function rewriteReduxImport(file: FileContext, reduxImport: ReduxImport): void {
  const { node, named, hasNonNamed } = reduxImport;

  const knownNames: string[] = [];
  const unknownNames: string[] = [];
  for (const imported of named.keys()) {
    if (RTK_REEXPORTED.has(imported) || STORE_CREATORS.has(imported)) knownNames.push(imported);
    else unknownNames.push(imported);
  }

  if (knownNames.length === 0) return; // nothing RTK-related to move.

  const canRetargetInPlace = !hasNonNamed && unknownNames.length === 0;

  if (canRetargetInPlace) {
    // Swap createStore/legacy_createStore specifiers → configureStore, and
    // retarget the source to @reduxjs/toolkit, preserving other specifiers/aliases.
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      const s = cast<ImportSpecifier>(spec);
      if (s.imported.type !== "Identifier") continue;
      const importedName = cast<Identifier>(s.imported).name;
      if (STORE_CREATORS.has(importedName)) {
        // Call sites are rewritten to `configureStore(...)` directly (see
        // `rewriteStoreCalls`), so the local alias is never referenced afterwards
        // — emit a clean `configureStore` specifier, no `as <local>`.
        file.magic.update(s.start, s.end, "configureStore");
      }
    }
    // Retarget the source string (including quotes).
    file.magic.update(node.source.start, node.source.end, JSON.stringify(RTK_MODULE));
    return;
  }

  // Split case: build a fresh RTK import for the known names and prune them from
  // the original `redux` import. Preserve local aliases.
  const rtkSpecifiers: string[] = [];
  for (const imported of knownNames) {
    if (STORE_CREATORS.has(imported)) {
      // Call sites become `configureStore(...)` directly, so no alias is needed.
      rtkSpecifiers.push("configureStore");
      continue;
    }
    const local = named.get(imported) ?? imported;
    rtkSpecifiers.push(local === imported ? imported : `${imported} as ${local}`);
  }
  // Deduplicate configureStore if both createStore and legacy_createStore appeared
  // (unlikely, but keep it safe).
  const uniqueSpecifiers = [...new Set(rtkSpecifiers)];
  const rtkImport = `import { ${uniqueSpecifiers.join(", ")} } from ${JSON.stringify(RTK_MODULE)};`;

  // Remove the known specifiers from the original import, keep the rest on redux.
  removeKnownSpecifiers(file, node, knownNames);
  // Prepend the new RTK import (keeps redux import in place for the leftovers).
  file.magic.prependLeft(node.start, `${rtkImport}\n`);
}

/**
 * Remove the given imported names from an import declaration's specifier list,
 * adjusting the surrounding commas so the remaining specifiers stay well-formed.
 */
function removeKnownSpecifiers(
  file: FileContext,
  node: ImportDeclaration,
  removeImported: string[],
): void {
  const toRemove = new Set(removeImported);
  const specs = node.specifiers;
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    if (!spec || spec.type !== "ImportSpecifier") continue;
    const s = cast<ImportSpecifier>(spec);
    if (s.imported.type !== "Identifier") continue;
    if (!toRemove.has(cast<Identifier>(s.imported).name)) continue;

    // Remove the specifier plus one adjacent comma to avoid `{ , foo }` / `{ foo, }`.
    const prev = specs[i - 1];
    const next = specs[i + 1];
    if (next) {
      // Remove up to (but not including) the next specifier: covers trailing comma+ws.
      file.magic.remove(spec.start, next.start);
    } else if (prev) {
      // Last one: remove from the end of the previous specifier (drops the comma).
      file.magic.remove(prev.end, spec.end);
    } else {
      file.magic.remove(spec.start, spec.end);
    }
  }
}

/** Rewrite `createStore(reducer[, preloadedState][, enhancer])` call sites. */
function rewriteStoreCalls(file: FileContext, storeCreatorLocals: Set<string>): void {
  walk(file.program, (node) => {
    if (node.type !== "CallExpression") return;
    const call = cast<CallExpression>(node);
    if (call.callee.type !== "Identifier") return;
    if (!storeCreatorLocals.has(cast<Identifier>(call.callee).name)) return;

    const args = call.arguments;
    const reducerArg = args[0];
    if (!reducerArg) {
      // `createStore()` with no reducer — leave a warn, don't produce broken code.
      file.report({
        message:
          "`createStore()` called without a reducer; convert to `configureStore({ reducer })` manually.",
        severity: "warn",
      });
      return;
    }

    const reducerText = file.source.slice(reducerArg.start, reducerArg.end);
    // A "preloadedState" second arg vs an enhancer: redux disambiguates by type at
    // runtime. Statically we treat a plain call (applyMiddleware/compose) as an
    // enhancer and everything else as preloadedState. This is a best-effort guess.
    const secondArg = args[1];
    const thirdArg = args[2];

    const configParts = [`reducer: ${reducerText}`];
    let enhancerText: string | null = null;

    for (const extra of [secondArg, thirdArg]) {
      if (!extra) continue;
      if (isEnhancerLike(extra, file)) {
        enhancerText = file.source.slice(extra.start, extra.end);
      } else {
        const preloadedText = file.source.slice(extra.start, extra.end);
        configParts.push(`preloadedState: ${preloadedText}`);
      }
    }

    const objectLiteral = `configureStore({ ${configParts.join(", ")} })`;
    file.magic.update(call.start, call.end, objectLiteral);

    if (enhancerText !== null) {
      file.report({
        message:
          "Middleware/enhancers passed to `createStore` must be moved to `configureStore`'s " +
          "`middleware`/`enhancers` option. Left the original as a TODO.",
        severity: "warn",
      });
      // Leave the original enhancer text as a breadcrumb right after the call.
      file.magic.appendLeft(
        call.end,
        ` /* TODO(omnimod): move to configureStore middleware/enhancers: ${enhancerText} */`,
      );
    }
  });
}

/** Heuristic: is this argument an enhancer (applyMiddleware/compose call) vs preloadedState? */
function isEnhancerLike(arg: Node, file: FileContext): boolean {
  if (arg.type !== "CallExpression") return false;
  const call = cast<CallExpression>(arg);
  const calleeName = calleeRootName(call.callee);
  if (calleeName === "applyMiddleware" || calleeName === "compose") return true;
  // `compose(...)(...)`-style or unknown call: treat as enhancer to be safe, since
  // preloadedState is rarely a call expression.
  const text = file.source.slice(arg.start, arg.end);
  return /applyMiddleware|compose|enhancer|middleware/i.test(text);
}

/** Root identifier name of a (possibly member/call) callee, else null. */
function calleeRootName(node: Node): string | null {
  if (node.type === "Identifier") return cast<Identifier>(node).name;
  if (node.type === "MemberExpression") return calleeRootName(cast<MemberExpression>(node).object);
  if (node.type === "CallExpression") return calleeRootName(cast<CallExpression>(node).callee);
  return null;
}

/**
 * Report (but never rewrite) the semantic migrations that need human judgement:
 * switch-based reducers, `connect(...)`, and saga/thunk middleware imports.
 */
function reportSemanticFollowups(file: FileContext): void {
  let reportedSwitchReducer = false;
  let reportedConnect = false;

  walk(file.program, (node) => {
    // (1) Switch-based reducer function: (state = init, action) => { switch (...) }.
    if (!reportedSwitchReducer && isSwitchReducer(node)) {
      reportedSwitchReducer = true;
      file.report({
        message:
          "Switch-statement reducer detected: convert it to `createSlice` (reducers map + " +
          "generated action creators).",
        severity: "warn",
      });
      file.magic.appendLeft(
        node.start,
        "// TODO(omnimod): convert this switch reducer to createSlice.\n",
      );
    }

    // (2) connect(mapStateToProps, mapDispatchToProps)(Component).
    if (!reportedConnect && isConnectCall(node)) {
      reportedConnect = true;
      file.report({
        message:
          "`connect()` detected: prefer the `useSelector`/`useDispatch` hooks from react-redux.",
        severity: "warn",
      });
    }
  });

  // (3) redux-saga / redux-thunk imports.
  for (const stmt of file.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const imp = cast<ImportDeclaration>(stmt);
    const src = imp.source.value;
    if (src === "redux-saga" || src.startsWith("redux-saga/") || src === "redux-thunk") {
      file.report({
        message: `\`${src}\` middleware detected: RTK ships \`createAsyncThunk\`/listener middleware; migrate async logic accordingly.`,
        severity: "info",
      });
    }
  }
}

/**
 * True for a function whose body is (or immediately contains) a `switch` on an
 * `action.type`-shaped discriminant and whose first param defaults to an initial
 * state — the classic hand-written reducer shape.
 */
function isSwitchReducer(node: Node): boolean {
  let params: Node[];
  let body: Node;
  if (node.type === "ArrowFunctionExpression") {
    const fn = cast<ArrowFunctionExpression>(node);
    params = fn.params;
    body = fn.body;
  } else if (node.type === "FunctionDeclaration") {
    const fn = cast<FunctionDeclaration>(node);
    params = fn.params;
    body = fn.body;
  } else if (node.type === "FunctionExpression") {
    const fn = cast<FunctionExpression>(node);
    params = fn.params;
    body = fn.body;
  } else {
    return false;
  }

  // Reducer signature: (state, action) — at least two params, first commonly with
  // a default (state = initialState).
  if (params.length < 2) return false;
  const firstIsDefaulted = params[0]?.type === "AssignmentPattern";
  if (!firstIsDefaulted) return false;

  // Body must be a block whose statements include a top-level switch.
  if (!body || body.type !== "BlockStatement") return false;
  const stmts = (body as { body?: Node[] }).body ?? [];
  return stmts.some((stmt) => stmt.type === "SwitchStatement");
}

/** True for `connect(...)(Component)` or `connect(...)` from react-redux. */
function isConnectCall(node: Node): boolean {
  if (node.type !== "CallExpression") return false;
  const call = cast<CallExpression>(node);
  // Either `connect(...)` directly, or the outer `connect(...)(Component)`.
  const inner = call.callee;
  if (inner.type === "Identifier" && cast<Identifier>(inner).name === "connect") return true;
  if (inner.type === "CallExpression") {
    const innerCall = cast<CallExpression>(inner);
    if (
      innerCall.callee.type === "Identifier" &&
      cast<Identifier>(innerCall.callee).name === "connect"
    ) {
      return true;
    }
  }
  return false;
}
