import { definePlugin, type FileContext, type Node, walk } from "@omnimod/core";
import {
  type CallExpression,
  cast,
  type Identifier,
  type ImportDeclaration,
  type ImportSpecifier,
} from "@omnimod/plugin-utils";

export type LodashToEsToolkitOptions = Record<string, unknown>;

const LODASH_SOURCES = new Set(["lodash", "lodash-es"]);
const ES_TOOLKIT_SOURCE = "es-toolkit";

/**
 * Names that es-toolkit re-exports under the same identifier. The import source is
 * rewritten to "es-toolkit" and the specifier kept verbatim.
 */
const SUPPORTED = new Set<string>([
  "debounce",
  "throttle",
  "cloneDeep",
  "clone",
  "isEqual",
  "isEqualWith",
  "groupBy",
  "keyBy",
  "uniq",
  "uniqBy",
  "uniqWith",
  "difference",
  "differenceBy",
  "intersection",
  "intersectionBy",
  "omit",
  "omitBy",
  "pick",
  "pickBy",
  "mapValues",
  "mapKeys",
  "merge",
  "mergeWith",
  "chunk",
  "compact",
  "flatten",
  "flattenDeep",
  "drop",
  "dropRight",
  "take",
  "takeRight",
  "zip",
  "unzip",
  "sum",
  "sumBy",
  "mean",
  "meanBy",
  "maxBy",
  "minBy",
  "sortBy",
  "orderBy",
  "range",
  "random",
  "sample",
  "sampleSize",
  "shuffle",
  "capitalize",
  "camelCase",
  "kebabCase",
  "snakeCase",
  "startCase",
  "upperFirst",
  "lowerFirst",
  "isNil",
  "isPlainObject",
  "isBoolean",
  "isString",
  "isNumber",
  "isFunction",
  "isDate",
  "isRegExp",
  "isSymbol",
  "delay",
  "once",
  "memoize",
  "partition",
  "countBy",
  "invert",
  "toMerged",
  "head",
  "last",
  "initial",
  "tail",
]);

/**
 * Native-safe rewrites: the import specifier is dropped and simple call sites
 * `name(...args)` are rewritten to the native callee. `noop` maps to an inlined
 * arrow. Only trivial call forms are rewritten; anything else keeps the import.
 */
const NATIVE_CALLEE: Record<string, string> = {
  isArray: "Array.isArray",
  isInteger: "Number.isInteger",
  isNaN: "Number.isNaN",
  isFinite: "Number.isFinite",
};
const NATIVE_NAMES = new Set([...Object.keys(NATIVE_CALLEE), "noop"]);

/** Names left on lodash because their es-toolkit / native semantics diverge. */
const UNSUPPORTED_REASON: Record<string, string> = {
  get: "lodash.get has no direct es-toolkit equivalent (path access differs)",
  set: "lodash.set has no direct es-toolkit equivalent",
  has: "lodash.has has no direct es-toolkit equivalent",
  isEmpty: "es-toolkit.isEmpty diverges from lodash.isEmpty",
  map: "lodash collection semantics (objects/iteratee shorthand) differ",
  filter: "lodash collection semantics (objects/iteratee shorthand) differ",
  reduce: "lodash collection semantics (objects/iteratee shorthand) differ",
  forEach: "lodash collection semantics (objects/iteratee shorthand) differ",
  template: "lodash.template has no es-toolkit equivalent",
  chain: "lodash.chain has no es-toolkit equivalent",
  flow: "lodash.flow has no direct es-toolkit equivalent",
};

interface NamedSpec {
  /** The imported (source) name, e.g. `debounce`. */
  imported: string;
  /** The local binding name, e.g. `debounce` or an alias. */
  local: string;
  /** The specifier node (for precise removal). */
  node: Node;
}

/**
 * Migrate named `lodash` / `lodash-es` imports to `es-toolkit`, rewriting a small
 * set of native-safe helpers to their JS built-ins and leaving divergent helpers
 * on lodash (with a diagnostic). Default (`import _ from "lodash"`) and namespace
 * imports are reported and left untouched.
 */
export const lodashToEsToolkit = definePlugin<LodashToEsToolkitOptions>({
  name: "lodash-to-es-toolkit",
  description: "Migrate lodash to es-toolkit (and native where safe).",
  include: ["**/*.{ts,tsx,js,jsx,mts,cts}"],

  transform(file: FileContext): void {
    for (const stmt of file.program.body) {
      if (stmt.type !== "ImportDeclaration") continue;
      const imp = cast<ImportDeclaration>(stmt);
      if (!LODASH_SOURCES.has(imp.source.value)) continue;
      convertImport(file, imp);
    }
  },
});

function convertImport(file: FileContext, imp: ImportDeclaration): void {
  const named: NamedSpec[] = [];
  let hasDefault = false;
  let hasNamespace = false;

  for (const spec of imp.specifiers) {
    if (spec.type === "ImportDefaultSpecifier") {
      hasDefault = true;
    } else if (spec.type === "ImportNamespaceSpecifier") {
      hasNamespace = true;
    } else if (spec.type === "ImportSpecifier") {
      const s = cast<ImportSpecifier>(spec);
      // `imported` is an Identifier for `{ a }` / `{ a as b }`; string-literal
      // imported names (`{ "x" as y }`) are unusual — skip them safely.
      if (s.imported.type !== "Identifier") continue;
      named.push({
        imported: cast<Identifier>(s.imported).name,
        local: s.local.name,
        node: spec,
      });
    }
  }

  // v1: default / namespace imports are not auto-converted.
  if (hasDefault) {
    file.report({
      severity: "warn",
      message: `Default \`${imp.source.value}\` import; convert to named imports manually.`,
    });
    return;
  }
  if (hasNamespace) {
    file.report({
      severity: "warn",
      message: `Namespace \`${imp.source.value}\` import; convert to named imports manually.`,
    });
    return;
  }
  if (named.length === 0) return;

  // Partition the named specifiers.
  const supported: NamedSpec[] = [];
  const nativeSafe: NamedSpec[] = [];
  const residual: NamedSpec[] = [];

  for (const spec of named) {
    if (SUPPORTED.has(spec.imported)) {
      supported.push(spec);
    } else if (NATIVE_NAMES.has(spec.imported) && canRewriteNative(spec)) {
      nativeSafe.push(spec);
    } else {
      residual.push(spec);
      const reason =
        UNSUPPORTED_REASON[spec.imported] ??
        `\`${spec.imported}\` has no known es-toolkit equivalent`;
      file.report({
        severity: "warn",
        message: `Left \`${spec.imported}\` on ${imp.source.value}: ${reason}`,
      });
    }
  }

  // Rewrite native-safe call sites first (they may span the whole file).
  for (const spec of nativeSafe) rewriteNativeUsages(file, spec);

  // If nothing at all can be moved to es-toolkit and there are no residuals to
  // preserve (only native-safe names), the whole import can be dropped.
  if (supported.length === 0 && residual.length === 0) {
    // Only native-safe names: the whole import can go.
    file.magic.remove(imp.start, imp.end);
    return;
  }

  if (residual.length === 0) {
    // Everything either supported or native-safe → single es-toolkit import.
    const line = renderImport(ES_TOOLKIT_SOURCE, supported);
    file.magic.update(imp.start, imp.end, line);
    return;
  }

  if (supported.length === 0) {
    // Nothing for es-toolkit; residuals stay on the original source. Drop any
    // native-safe specifiers by rebuilding the residual-only import.
    if (nativeSafe.length > 0) {
      const line = renderImport(imp.source.value, residual);
      file.magic.update(imp.start, imp.end, line);
    }
    // else: import is entirely residual & untouched — leave it verbatim.
    return;
  }

  // Split: supported → es-toolkit, residual → original source.
  const esLine = renderImport(ES_TOOLKIT_SOURCE, supported);
  const residualLine = renderImport(imp.source.value, residual);
  file.magic.update(imp.start, imp.end, `${esLine}\n${residualLine}`);
}

/** Render `import { a, b as c } from "source";` for a set of specifiers. */
function renderImport(source: string, specs: NamedSpec[]): string {
  const clauses = specs
    .map((spec) =>
      spec.local === spec.imported ? spec.imported : `${spec.imported} as ${spec.local}`,
    )
    .sort((a, b) => a.localeCompare(b));
  return `import { ${clauses.join(", ")} } from ${JSON.stringify(source)};`;
}

/**
 * Whether a native-safe specifier is trivially rewritable. `noop` is only safe
 * when it is never aliased (its local name is `noop`) — aliasing would require
 * tracking the binding, which v1 does not do.
 */
function canRewriteNative(spec: NamedSpec): boolean {
  if (spec.imported === "noop") {
    // Only rewrite the unaliased form so we can text-match usages precisely.
    return spec.local === "noop";
  }
  return true;
}

/**
 * Rewrite call sites of a native-safe helper. For the mapped built-ins we only
 * rewrite direct call callees (`name(...)`), leaving any non-call reference (e.g.
 * passing `isArray` as a value) untouched. `noop` references are replaced with an
 * inlined `(() => {})` arrow.
 */
function rewriteNativeUsages(file: FileContext, spec: NamedSpec): void {
  const nativeCallee = NATIVE_CALLEE[spec.imported];

  walk(file.program, (node, parent, key) => {
    // Never treat the import specifier's own identifier as a usage.
    if (node === spec.node) return "skip";

    if (nativeCallee) {
      if (node.type !== "CallExpression") return;
      const call = cast<CallExpression>(node);
      if (call.callee.type !== "Identifier") return;
      if (cast<Identifier>(call.callee).name !== spec.local) return;
      // Rewrite only the callee, preserving the original arguments verbatim.
      file.magic.update(call.callee.start, call.callee.end, nativeCallee);
      return;
    }

    // noop: replace bare identifier references (not member `.noop`, not the
    // import specifier). Guard against property keys / member access.
    if (node.type !== "Identifier") return;
    if (cast<Identifier>(node).name !== spec.local) return;
    if (parent && parent.type === "MemberExpression" && key === "property") return;
    if (parent && parent.type === "ImportSpecifier") return "skip";
    file.magic.update(node.start, node.end, "(() => {})");
    return;
  });
}
