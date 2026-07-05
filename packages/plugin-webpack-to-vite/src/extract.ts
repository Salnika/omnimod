import type { Node, Program } from "@omnimod/core";
import {
  type ArrayExpression,
  type AssignmentExpression,
  cast,
  type ExportDefaultDeclaration,
  type ExpressionStatement,
  type Identifier,
  type Literal,
  type MemberExpression,
  type NewExpression,
  type ObjectExpression,
  type Property,
} from "@omnimod/plugin-utils";

/** An `alias` entry: key → the source text of its value (kept verbatim). */
interface AliasEntry {
  key: string;
  /** Source text of the value expression. */
  valueSource: string;
  /** A plain string value, when the RHS was a static string literal. */
  literal: string | null;
}

export interface RuleInfo {
  /** Source text of the `test` field, e.g. `/\.css$/`. */
  test: string | null;
  /** Loader names referenced by the rule (best-effort). */
  loaders: string[];
}

/** Everything we could read statically out of a webpack config object. */
export interface WebpackConfig {
  /** Whether a config object was found at all. */
  found: boolean;
  aliases: AliasEntry[];
  /** Whether any alias value was non-trivial (path.resolve(...), etc.). */
  aliasesHaveHelpers: boolean;
  extensions: string[] | null;
  /** DefinePlugin values: define key → source text of the value. */
  define: { key: string; valueSource: string }[];
  devServerPort: string | null;
  /** Source text of `devServer.proxy`, when present. */
  devServerProxy: string | null;
  /** Source text of `entry`, when present. */
  entry: string | null;
  /** Source text of `output`, when present. */
  output: string | null;
  rules: RuleInfo[];
}

/** Read a property's key name (identifier or string literal). */
function keyName(key: Node): string | null {
  if (key.type === "Identifier") return cast<Identifier>(key).name;
  if (key.type === "Literal") {
    const value = cast<Literal>(key).value;
    return typeof value === "string" ? value : String(value);
  }
  return null;
}

/** Find a property by name on an object expression. */
function prop(obj: ObjectExpression, name: string): Property | null {
  for (const p of obj.properties) {
    if (p.type !== "Property") continue;
    const property = cast<Property>(p);
    if (keyName(property.key) === name) return property;
  }
  return null;
}

function asObject(node: Node | null): ObjectExpression | null {
  if (!node || node.type !== "ObjectExpression") return null;
  return cast<ObjectExpression>(node);
}

function stringLiteral(node: Node | null): string | null {
  if (!node || node.type !== "Literal") return null;
  const value = cast<Literal>(node).value;
  return typeof value === "string" ? value : null;
}

/**
 * Find the exported config object: `module.exports = {…}` or
 * `export default {…}`. Function/array-returning configs are not resolved
 * statically (they yield `found: false`).
 */
function findConfigObject(program: Program): ObjectExpression | null {
  for (const stmt of program.body) {
    if (stmt.type === "ExpressionStatement") {
      const expr = cast<ExpressionStatement>(stmt).expression;
      if (expr.type !== "AssignmentExpression") continue;
      const assign = cast<AssignmentExpression>(expr);
      if (!isModuleExports(assign.left)) continue;
      const obj = asObject(assign.right);
      if (obj) return obj;
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const decl = cast<ExportDefaultDeclaration>(stmt).declaration;
      const obj = asObject(decl);
      if (obj) return obj;
    }
  }
  return null;
}

/** True when `node` is the `module.exports` member expression. */
function isModuleExports(node: Node): boolean {
  if (node.type !== "MemberExpression") return false;
  const member = cast<MemberExpression>(node);
  if (member.object.type !== "Identifier" || member.property.type !== "Identifier") return false;
  return (
    cast<Identifier>(member.object).name === "module" &&
    cast<Identifier>(member.property).name === "exports"
  );
}

/** Collect alias entries from `resolve.alias`. */
function readAliases(
  aliasObj: ObjectExpression,
  source: string,
): { aliases: AliasEntry[]; haveHelpers: boolean } {
  const aliases: AliasEntry[] = [];
  let haveHelpers = false;
  for (const p of aliasObj.properties) {
    if (p.type !== "Property") continue;
    const property = cast<Property>(p);
    const key = keyName(property.key);
    if (key === null) continue;
    const literal = stringLiteral(property.value);
    if (literal === null) haveHelpers = true;
    aliases.push({
      key,
      valueSource: source.slice(property.value.start, property.value.end),
      literal,
    });
  }
  return { aliases, haveHelpers };
}

/** Read a string array like `extensions: [".js", ".ts"]`. */
function readStringArray(node: Node | null): string[] | null {
  if (!node || node.type !== "ArrayExpression") return null;
  const arr = cast<ArrayExpression>(node);
  const out: string[] = [];
  for (const el of arr.elements) {
    if (!el) continue;
    const str = stringLiteral(el);
    if (str !== null) out.push(str);
  }
  return out;
}

/** Read `plugins: [ new webpack.DefinePlugin({...}) ]` into define entries. */
function readDefine(
  pluginsNode: Node | null,
  source: string,
): { key: string; valueSource: string }[] {
  if (!pluginsNode || pluginsNode.type !== "ArrayExpression") return [];
  const arr = cast<ArrayExpression>(pluginsNode);
  const out: { key: string; valueSource: string }[] = [];
  for (const el of arr.elements) {
    if (!el || el.type !== "NewExpression") continue;
    const created = cast<NewExpression>(el);
    if (!isDefinePlugin(created.callee)) continue;
    const arg = created.arguments[0];
    const obj = asObject(arg ?? null);
    if (!obj) continue;
    for (const p of obj.properties) {
      if (p.type !== "Property") continue;
      const property = cast<Property>(p);
      const key = keyName(property.key);
      if (key === null) continue;
      out.push({ key, valueSource: source.slice(property.value.start, property.value.end) });
    }
  }
  return out;
}

/** True when a callee resolves to `DefinePlugin` (bare or `webpack.DefinePlugin`). */
function isDefinePlugin(callee: Node): boolean {
  if (callee.type === "Identifier") return cast<Identifier>(callee).name === "DefinePlugin";
  if (callee.type === "MemberExpression") {
    const member = cast<MemberExpression>(callee);
    return (
      member.property.type === "Identifier" &&
      cast<Identifier>(member.property).name === "DefinePlugin"
    );
  }
  return false;
}

/** Read `module.rules: [...]` into a list of test + loader names. */
function readRules(moduleNode: Node | null, source: string): RuleInfo[] {
  const moduleObj = asObject(moduleNode);
  if (!moduleObj) return [];
  const rulesProp = prop(moduleObj, "rules");
  if (!rulesProp || rulesProp.value.type !== "ArrayExpression") return [];
  const rules = cast<ArrayExpression>(rulesProp.value);
  const out: RuleInfo[] = [];
  for (const el of rules.elements) {
    const ruleObj = asObject(el ?? null);
    if (!ruleObj) continue;
    const testProp = prop(ruleObj, "test");
    const test = testProp ? source.slice(testProp.value.start, testProp.value.end) : null;
    out.push({ test, loaders: readLoaders(ruleObj) });
  }
  return out;
}

/** Gather loader names from a rule's `use` / `loader` fields. */
function readLoaders(ruleObj: ObjectExpression): string[] {
  const loaders: string[] = [];
  const loaderProp = prop(ruleObj, "loader");
  if (loaderProp) {
    const str = stringLiteral(loaderProp.value);
    if (str !== null) loaders.push(str);
  }
  const useProp = prop(ruleObj, "use");
  if (useProp) collectUse(useProp.value, loaders);
  return loaders;
}

/** `use` can be a string, an array of strings/objects, or `{ loader }` objects. */
function collectUse(node: Node, out: string[]): void {
  const str = stringLiteral(node);
  if (str !== null) {
    out.push(str);
    return;
  }
  if (node.type === "ArrayExpression") {
    for (const el of cast<ArrayExpression>(node).elements) {
      if (el) collectUse(el, out);
    }
    return;
  }
  const obj = asObject(node);
  if (obj) {
    const loaderProp = prop(obj, "loader");
    if (loaderProp) {
      const value = stringLiteral(loaderProp.value);
      if (value !== null) out.push(value);
    }
  }
}

/** Parse the webpack config into the statically-readable fields we support. */
export function extractConfig(program: Program, source: string): WebpackConfig {
  const empty: WebpackConfig = {
    found: false,
    aliases: [],
    aliasesHaveHelpers: false,
    extensions: null,
    define: [],
    devServerPort: null,
    devServerProxy: null,
    entry: null,
    output: null,
    rules: [],
  };

  const config = findConfigObject(program);
  if (!config) return empty;

  const resolveObj = asObject(prop(config, "resolve")?.value ?? null);
  let aliases: AliasEntry[] = [];
  let aliasesHaveHelpers = false;
  let extensions: string[] | null = null;
  if (resolveObj) {
    const aliasObj = asObject(prop(resolveObj, "alias")?.value ?? null);
    if (aliasObj) {
      const read = readAliases(aliasObj, source);
      aliases = read.aliases;
      aliasesHaveHelpers = read.haveHelpers;
    }
    extensions = readStringArray(prop(resolveObj, "extensions")?.value ?? null);
  }

  const define = readDefine(prop(config, "plugins")?.value ?? null, source);

  const devServerObj = asObject(prop(config, "devServer")?.value ?? null);
  let devServerPort: string | null = null;
  let devServerProxy: string | null = null;
  if (devServerObj) {
    const portProp = prop(devServerObj, "port");
    if (portProp) devServerPort = source.slice(portProp.value.start, portProp.value.end);
    const proxyProp = prop(devServerObj, "proxy");
    if (proxyProp) devServerProxy = source.slice(proxyProp.value.start, proxyProp.value.end);
  }

  const entryProp = prop(config, "entry");
  const entry = entryProp ? source.slice(entryProp.value.start, entryProp.value.end) : null;
  const outputProp = prop(config, "output");
  const output = outputProp ? source.slice(outputProp.value.start, outputProp.value.end) : null;

  const rules = readRules(prop(config, "module")?.value ?? null, source);

  return {
    found: true,
    aliases,
    aliasesHaveHelpers,
    extensions,
    define,
    devServerPort,
    devServerProxy,
    entry,
    output,
    rules,
  };
}
