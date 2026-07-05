import { definePlugin, type FileContext, type Node } from "@omnimod/core";
import {
  cast,
  type BlockStatement,
  type ClassDeclaration,
  type FunctionExpression,
  type Identifier,
  type ImportDeclaration,
  type ImportSpecifier,
  type MethodDefinition,
  type ObjectExpression,
  type Property,
  type PropertyDefinition,
} from "@omnimod/plugin-utils";
import { type ClassInfo, type ClassMember, findClassComponents } from "./detect.ts";
import { rewriteThis, setterName, type StateInfo } from "./rewrite.ts";

export type ReactClassToHooksOptions = Record<string, unknown>;

/**
 * Migrate SIMPLE React class components to function components + hooks. This is
 * intentionally conservative: only classes with a `render()`, optional
 * `state = { ... }`, optional mount/unmount/update lifecycles, and plain methods
 * are converted. Anything with a constructor body, refs, context, unsupported
 * lifecycle, or a multi-key/functional `setState` is left untouched with a warn.
 */
export const reactClassToHooks = definePlugin<ReactClassToHooksOptions>({
  name: "react-class-to-hooks",
  description: "Migrate simple React class components to function components + hooks.",
  include: ["**/*.{tsx,jsx}"],

  transform(file: FileContext): void {
    const classes = findClassComponents(file.program);
    if (classes.length === 0) return;

    const hooksUsed = new Set<string>();
    let anyConverted = false;

    for (const found of classes) {
      const info = found.info;
      if (info.bail) {
        file.report({
          message: `Left \`${info.name ?? "class component"}\` as a class: ${info.bail}.`,
          severity: "warn",
        });
        continue;
      }
      if (!info.name) {
        file.report({
          message: "Left an anonymous class component untouched (no name to convert to).",
          severity: "warn",
        });
        continue;
      }

      const converted = convertClass(file, info, info.name);
      if (!converted) continue; // convertClass already reported the reason.
      for (const hook of converted.hooks) hooksUsed.add(hook);
      anyConverted = true;
    }

    if (anyConverted && hooksUsed.size > 0) {
      ensureReactHookImports(file, hooksUsed);
    }
  },
});

interface Converted {
  hooks: Set<string>;
}

/** Build the function-component text and replace the class in place. */
function convertClass(file: FileContext, info: ClassInfo, name: string): Converted | null {
  const hooks = new Set<string>();

  // --- classify members ---
  let stateField: ClassMember | null = null;
  let render: ClassMember | null = null;
  let mount: ClassMember | null = null;
  let unmount: ClassMember | null = null;
  let update: ClassMember | null = null;
  const methods: ClassMember[] = [];
  let defaultProps: ClassMember | null = null;

  for (const member of info.members) {
    switch (member.kind) {
      case "state-field":
        stateField = member;
        break;
      case "render":
        render = member;
        break;
      case "lifecycle-mount":
        mount = member;
        break;
      case "lifecycle-unmount":
        unmount = member;
        break;
      case "lifecycle-update":
        update = member;
        break;
      case "method":
        methods.push(member);
        break;
      case "default-props":
        defaultProps = member;
        break;
      case "constructor":
        break;
    }
  }

  if (!render) {
    file.report({ message: `Left \`${name}\`: no render() found.`, severity: "warn" });
    return null;
  }

  // --- state → useState ---
  const state = parseState(file, stateField);
  if (state === "bail") {
    file.report({
      message: `Left \`${name}\`: \`state\` is not a simple object literal.`,
      severity: "warn",
    });
    return null;
  }
  if (state.keys.length > 0) hooks.add("useState");

  const lines: string[] = [];

  for (const key of state.keys) {
    const initText = state.inits.get(key) ?? "undefined";
    lines.push(`  const [${key}, ${state.setters.get(key)}] = useState(${initText});`);
  }

  // --- methods ---
  for (const method of methods) {
    const rendered = renderMethod(file, method, state);
    if (rendered === null) {
      file.report({
        message: `Left \`${name}\`: method \`${method.name}\` uses an unsupported \`setState\` (multi-key or updater fn).`,
        severity: "warn",
      });
      return null;
    }
    lines.push(rendered);
  }

  // --- lifecycles → useEffect ---
  if (mount || unmount) {
    hooks.add("useEffect");
    const effect = renderMountEffect(file, mount, unmount, state);
    if (effect === null) {
      file.report({
        message: `Left \`${name}\`: a lifecycle method uses an unsupported \`setState\`.`,
        severity: "warn",
      });
      return null;
    }
    lines.push(effect);
  }
  if (update) {
    hooks.add("useEffect");
    const body = methodBodyText(file, update, state);
    if (body === null) {
      file.report({
        message: `Left \`${name}\`: componentDidUpdate uses an unsupported \`setState\`.`,
        severity: "warn",
      });
      return null;
    }
    lines.push(`  // TODO(omnimod): review this effect's dependency array.`);
    lines.push(`  useEffect(() => {${body}});`);
    file.report({
      message: `Converted \`${name}\`.componentDidUpdate to a useEffect — review its dependency array.`,
      severity: "info",
    });
  }

  // --- render body → return ---
  const renderReturn = renderRenderBody(file, render, state);
  if (renderReturn === null) {
    file.report({
      message: `Left \`${name}\`: render() uses an unsupported \`setState\`.`,
      severity: "warn",
    });
    return null;
  }
  lines.push(renderReturn);

  const body = lines.join("\n");
  const fnText = `function ${name}(props) {\n${body}\n}`;

  // Replace the class node (the `class ... { ... }` expression) with the fn.
  const classNode: ClassDeclaration = info.node;
  file.magic.update(classNode.start, classNode.end, fnText);

  // `Name.defaultProps = {...}` stays valid on a function; keep as-is (v1).
  void defaultProps;

  return { hooks };
}

interface ParsedState {
  keys: string[];
  setters: Map<string, string>;
  inits: Map<string, string>;
}

/** Parse `state = { k: v }` into keys, setters and init-expression text. */
function parseState(file: FileContext, field: ClassMember | null): ParsedState | "bail" {
  const keys: string[] = [];
  const setters = new Map<string, string>();
  const inits = new Map<string, string>();
  if (!field) return { keys, setters, inits };

  const prop = cast<PropertyDefinition>(field.node);
  if (!prop.value || prop.value.type !== "ObjectExpression") return "bail";
  const obj = cast<ObjectExpression>(prop.value);

  for (const raw of obj.properties) {
    if (raw.type !== "Property") return "bail";
    const property = cast<Property>(raw);
    if (property.computed || property.kind !== "init") return "bail";
    if (property.key.type !== "Identifier") return "bail";
    const key = cast<Identifier>(property.key).name;
    keys.push(key);
    setters.set(key, setterName(key));
    inits.set(key, file.source.slice(property.value.start, property.value.end));
  }

  return { keys, setters, inits };
}

/** The `StateInfo` view expected by the `this.*` rewriter. */
function stateInfo(state: ParsedState): StateInfo {
  return { keys: state.keys, setters: state.setters };
}

/** Render a plain method as `const foo = (params) => { body };`. */
function renderMethod(file: FileContext, member: ClassMember, state: ParsedState): string | null {
  const node = member.node;
  let fn: FunctionExpression;
  if (node.type === "MethodDefinition") {
    fn = cast<MethodDefinition>(node).value;
  } else {
    // Arrow-function class field.
    const prop = cast<PropertyDefinition>(node);
    fn = cast<FunctionExpression>(prop.value as Node);
  }

  const params = file.source.slice(paramsStart(file, fn), paramsEnd(file, fn));
  const rewritten = rewriteThis(file.source, fn.body, stateInfo(state));
  if (rewritten.unsupportedSetState) return null;

  // `fn.body` is either a block (`{ ... }`) or an expression (arrow shorthand);
  // either way it forms a valid arrow-function body verbatim.
  return `  const ${member.name} = (${params}) => ${rewritten.text};`;
}

/** Get the source span text of a function/method body ({...} → inner text). */
function methodBodyText(file: FileContext, member: ClassMember, state: ParsedState): string | null {
  const node = member.node;
  const fn = cast<MethodDefinition>(node).value;
  const block = cast<BlockStatement>(fn.body);
  // Inner text between the braces.
  const rewritten = rewriteThis(file.source, block, stateInfo(state));
  if (rewritten.unsupportedSetState) return null;
  // Strip the outer braces from the rewritten block text.
  const inner = rewritten.text.slice(1, -1);
  return inner;
}

/** componentDidMount → useEffect(() => { B; [return cleanup;] }, []). */
function renderMountEffect(
  file: FileContext,
  mount: ClassMember | null,
  unmount: ClassMember | null,
  state: ParsedState,
): string | null {
  let mountBody = "";
  if (mount) {
    const body = methodBodyText(file, mount, state);
    if (body === null) return null;
    mountBody = body;
  }
  let cleanup = "";
  if (unmount) {
    const body = methodBodyText(file, unmount, state);
    if (body === null) return null;
    cleanup = `\n    return () => {${body}};`;
  }
  return `  useEffect(() => {${mountBody}${cleanup}\n  }, []);`;
}

/** render() { return X; } → `  return X;` (with `this.*` rewritten). */
function renderRenderBody(
  file: FileContext,
  render: ClassMember,
  state: ParsedState,
): string | null {
  const fn = cast<MethodDefinition>(render.node).value;
  const block = cast<BlockStatement>(fn.body);
  const rewritten = rewriteThis(file.source, block, stateInfo(state));
  if (rewritten.unsupportedSetState) return null;
  // Drop the outer braces, then dedent and re-indent under the function body.
  const inner = rewritten.text.slice(1, -1);
  const reindented = reindent(inner, "  ");
  return reindented.length > 0 ? reindented : "  return null;";
}

/**
 * Remove the shared leading indentation from a multi-line block and re-apply
 * `prefix` to each non-blank line. Leading/trailing blank lines are trimmed.
 */
function reindent(block: string, prefix: string): string {
  const lines = block.replace(/^\n+/, "").replace(/\s+$/, "").split("\n");
  let common = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    if (indent < common) common = indent;
  }
  if (!Number.isFinite(common)) common = 0;
  return lines
    .map((line) => (line.trim().length === 0 ? "" : `${prefix}${line.slice(common)}`))
    .join("\n");
}

/** Start offset of a function's parameter list (just after the `(`). */
function paramsStart(file: FileContext, fn: FunctionExpression): number {
  const params = fn.params;
  if (params.length > 0) return params[0].start;
  // No params: find the "(" before the body.
  const open = file.source.indexOf("(", fn.start);
  return open + 1;
}

/** End offset of a function's parameter list (just before the `)`). */
function paramsEnd(file: FileContext, fn: FunctionExpression): number {
  const params = fn.params;
  if (params.length > 0) return params[params.length - 1].end;
  const open = file.source.indexOf("(", fn.start);
  return open + 1;
}

/**
 * Merge the required hooks into an existing `import ... from "react"` (adding a
 * named clause when needed) or prepend a fresh named import.
 */
function ensureReactHookImports(file: FileContext, hooks: Set<string>): void {
  const wanted = [...hooks].sort();

  for (const stmt of file.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const imp = cast<ImportDeclaration>(stmt);
    if (imp.source.value !== "react") continue;

    const existing = new Set<string>();
    let lastNamed: Node | null = null;
    let hasNamedBlock = false;
    for (const spec of imp.specifiers) {
      if (spec.type === "ImportSpecifier") {
        const s = cast<ImportSpecifier>(spec);
        if (s.imported.type === "Identifier") existing.add(cast<Identifier>(s.imported).name);
        lastNamed = spec;
        hasNamedBlock = true;
      }
    }

    const missing = wanted.filter((hook) => !existing.has(hook));
    if (missing.length === 0) return;

    if (hasNamedBlock && lastNamed) {
      // Append after the last named specifier: `, useState, useEffect`.
      file.magic.appendLeft(lastNamed.end, `, ${missing.join(", ")}`);
    } else {
      // Only a default import (e.g. `import React from "react"`): add a block.
      const def = imp.specifiers[0];
      if (def) file.magic.appendLeft(def.end, `, { ${missing.join(", ")} }`);
      else file.magic.appendLeft(imp.source.start - 6, `{ ${missing.join(", ")} } `);
    }
    return;
  }

  // No react import at all → prepend one.
  file.magic.prepend(`import { ${wanted.join(", ")} } from "react";\n`);
}
