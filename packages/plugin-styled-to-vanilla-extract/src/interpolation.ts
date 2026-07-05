import type { Node } from "@omnimod/core";
import {
  type ArrowFunctionExpression,
  type BinaryExpression,
  cast,
  type ConditionalExpression,
  type Identifier,
  type Literal,
  type LogicalExpression,
  type MemberExpression,
  type ObjectPattern,
  type Property,
  type TaggedTemplateExpression,
  type TemplateLiteral,
  type UnaryExpression,
} from "@omnimod/plugin-utils";

/** A variant branch value: a CSS literal or a theme token reference. */
export type BranchValue = { kind: "literal"; value: string } | { kind: "theme"; path: string };

/** A conditional CSS block (`css`...`` or a declaration template) toggled by a prop. */
export interface BlockSource {
  quasis: string[];
  expressions: Node[];
}

/** Classification of a single `${…}` interpolation inside a styled template. */
export type Interpolation =
  | { kind: "theme"; path: string }
  | { kind: "boolean-variant"; prop: string; whenTrue: BranchValue; whenFalse: BranchValue }
  | { kind: "enum-variant"; prop: string; cases: EnumCase[]; fallback: BranchValue | null }
  | {
      kind: "conditional-block";
      prop: string;
      whenTrue: BlockSource | null;
      whenFalse: BlockSource | null;
    }
  | { kind: "var"; prop: string }
  | { kind: "ref"; name: string }
  | { kind: "unsupported"; reason: string };

interface EnumCase {
  match: string;
  value: BranchValue;
}

interface ParamInfo {
  paramName: string | null;
  destructured: Set<string>;
}

/** oxc preserves parentheses as ParenthesizedExpression nodes; see through them. */
function unwrap(node: Node): Node {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = (current as unknown as { expression: Node }).expression;
  }
  return current;
}

/** Classify an interpolation expression node. */
export function analyzeInterpolation(expr: Node): Interpolation {
  if (expr.type === "Identifier") {
    return { kind: "ref", name: cast<Identifier>(expr).name };
  }
  if (expr.type !== "ArrowFunctionExpression") {
    return { kind: "unsupported", reason: "not an arrow function or identifier reference" };
  }
  const arrow = cast<ArrowFunctionExpression>(expr);
  if (!arrow.expression) return { kind: "unsupported", reason: "arrow has a block body" };
  return analyzeBody(arrow.body, paramInfo(arrow.params[0]));
}

function paramInfo(param: Node | undefined): ParamInfo {
  const destructured = new Set<string>();
  let paramName: string | null = null;
  if (param?.type === "Identifier") {
    paramName = cast<Identifier>(param).name;
  } else if (param?.type === "ObjectPattern") {
    for (const prop of cast<ObjectPattern>(param).properties) {
      if (prop.type !== "Property") continue;
      const key = cast<Property>(prop).key;
      if (key.type === "Identifier") destructured.add(cast<Identifier>(key).name);
    }
  }
  return { paramName, destructured };
}

function analyzeBody(body: Node, info: ParamInfo): Interpolation {
  const target = unwrap(body);
  if (target.type === "ConditionalExpression") {
    return analyzeConditional(cast<ConditionalExpression>(target), info);
  }
  // `prop && css`...`` / `prop && `decls`` → conditional block variant.
  if (target.type === "LogicalExpression" && cast<LogicalExpression>(target).operator === "&&") {
    const logical = cast<LogicalExpression>(target);
    const bool = booleanTest(logical.left, info);
    const block = blockSource(logical.right);
    if (bool && block) {
      return bool.negated
        ? { kind: "conditional-block", prop: bool.prop, whenTrue: null, whenFalse: block }
        : { kind: "conditional-block", prop: bool.prop, whenTrue: block, whenFalse: null };
    }
  }
  const theme = themePath(target, info);
  if (theme !== null) return { kind: "theme", path: theme };
  const prop = propAccess(target, info);
  if (prop !== null) return { kind: "var", prop };
  return { kind: "unsupported", reason: "unrecognized arrow body" };
}

function analyzeConditional(cond: ConditionalExpression, info: ParamInfo): Interpolation {
  const bool = booleanTest(cond.test, info);
  if (bool) {
    // `prop ? css`...` : null` → conditional block variant.
    const trueBlock = blockSource(cond.consequent);
    const falseBlock = blockSource(cond.alternate);
    if (trueBlock || falseBlock) {
      return {
        kind: "conditional-block",
        prop: bool.prop,
        whenTrue: bool.negated ? falseBlock : trueBlock,
        whenFalse: bool.negated ? trueBlock : falseBlock,
      };
    }
    const whenA = branchValue(cond.consequent, info);
    const whenB = branchValue(cond.alternate, info);
    if (whenA === null || whenB === null) {
      return { kind: "unsupported", reason: "non-literal ternary branch" };
    }
    return bool.negated
      ? { kind: "boolean-variant", prop: bool.prop, whenTrue: whenB, whenFalse: whenA }
      : { kind: "boolean-variant", prop: bool.prop, whenTrue: whenA, whenFalse: whenB };
  }

  const cases: EnumCase[] = [];
  let prop: string | null = null;
  let node: Node = cond;
  for (;;) {
    const target = unwrap(node);
    if (target.type !== "ConditionalExpression") {
      node = target;
      break;
    }
    const current = cast<ConditionalExpression>(target);
    const equality = equalityTest(current.test, info);
    if (!equality) {
      node = target;
      break;
    }
    if (prop === null) prop = equality.prop;
    else if (prop !== equality.prop) {
      return { kind: "unsupported", reason: "ternary chain spans multiple props" };
    }
    const value = branchValue(current.consequent, info);
    if (value === null) return { kind: "unsupported", reason: "non-literal enum branch" };
    cases.push({ match: equality.value, value });
    node = current.alternate;
  }

  if (prop !== null && cases.length > 0) {
    return { kind: "enum-variant", prop, cases, fallback: branchValue(node, info) };
  }
  return { kind: "unsupported", reason: "unrecognized conditional" };
}

function booleanTest(test: Node, info: ParamInfo): { prop: string; negated: boolean } | null {
  const target = unwrap(test);
  if (target.type === "UnaryExpression" && cast<UnaryExpression>(target).operator === "!") {
    const inner = booleanTest(cast<UnaryExpression>(target).argument, info);
    return inner ? { prop: inner.prop, negated: !inner.negated } : null;
  }
  const prop = propAccess(target, info);
  return prop !== null ? { prop, negated: false } : null;
}

function equalityTest(test: Node, info: ParamInfo): { prop: string; value: string } | null {
  const bin = cast<BinaryExpression>(unwrap(test));
  if (bin.type !== "BinaryExpression") return null;
  if (bin.operator !== "===" && bin.operator !== "==") return null;

  const leftProp = propAccess(bin.left, info);
  const rightLiteral = literalValue(bin.right);
  if (leftProp !== null && rightLiteral !== null) return { prop: leftProp, value: rightLiteral };

  const rightProp = propAccess(bin.right, info);
  const leftLiteral = literalValue(bin.left);
  if (rightProp !== null && leftLiteral !== null) return { prop: rightProp, value: leftLiteral };
  return null;
}

/** The prop name a node reads (e.g. `p.gap` or destructured `gap`), excluding `theme`. */
function propAccess(input: Node, info: ParamInfo): string | null {
  const node = unwrap(input);
  if (node.type === "MemberExpression") {
    const member = cast<MemberExpression>(node);
    if (member.computed || member.property.type !== "Identifier") return null;
    if (member.object.type !== "Identifier") return null;
    if (info.paramName === null || cast<Identifier>(member.object).name !== info.paramName)
      return null;
    const name = cast<Identifier>(member.property).name;
    return name === "theme" ? null : name;
  }
  if (node.type === "Identifier") {
    const name = cast<Identifier>(node).name;
    if (name !== "theme" && info.destructured.has(name)) return name;
  }
  return null;
}

/**
 * The dotted theme path a node reads. Handles computed access with literal keys,
 * so `theme.colors.blueGrey[900]` → "colors.blueGrey.900".
 */
function themePath(input: Node, info: ParamInfo): string | null {
  const node = unwrap(input);
  if (node.type !== "MemberExpression") return null;
  const parts: string[] = [];
  let current: Node = node;
  while (current.type === "MemberExpression") {
    const member = cast<MemberExpression>(current);
    if (member.computed) {
      const key = literalValue(member.property);
      if (key === null) return null;
      parts.unshift(key);
    } else if (member.property.type === "Identifier") {
      parts.unshift(cast<Identifier>(member.property).name);
    } else {
      return null;
    }
    current = member.object;
  }
  if (current.type !== "Identifier") return null;
  const rootName = cast<Identifier>(current).name;
  if (rootName === "theme" && info.destructured.has("theme")) return parts.join(".");
  if (info.paramName !== null && rootName === info.paramName && parts[0] === "theme") {
    return parts.slice(1).join(".");
  }
  return null;
}

/** Build a `vars` accessor for a dotted theme path, using brackets for non-identifiers. */
export function varsAccessor(path: string): string {
  let accessor = "vars";
  for (const segment of path.split(".")) {
    accessor += /^[A-Za-z_$][\w$]*$/.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }
  return accessor;
}

/** A CSS declaration block: a `css`...`` tag, or a template/string of declarations. */
function blockSource(node: Node): BlockSource | null {
  const target = unwrap(node);
  if (target.type === "TaggedTemplateExpression") {
    return templateBlock(cast<TaggedTemplateExpression>(target).quasi, true);
  }
  if (target.type === "TemplateLiteral") {
    return templateBlock(cast<TemplateLiteral>(target), false);
  }
  if (target.type === "Literal") {
    const value = cast<Literal>(target).value;
    if (typeof value === "string" && looksLikeCss(value)) {
      return { quasis: [value], expressions: [] };
    }
  }
  return null;
}

function templateBlock(template: TemplateLiteral, tagged: boolean): BlockSource | null {
  const quasis = template.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
  // A `css`...`` tag is always a block; a bare template must look like declarations.
  if (!tagged && !looksLikeCss(quasis.join(" "))) return null;
  return { quasis, expressions: template.expressions };
}

function looksLikeCss(text: string): boolean {
  return /[:;{]/.test(text);
}

/** A ternary/enum branch: a CSS literal or a theme token access. */
function branchValue(node: Node, info: ParamInfo): BranchValue | null {
  const target = unwrap(node);
  const literal = literalValue(target);
  if (literal !== null) return { kind: "literal", value: literal };
  const theme = themePath(target, info);
  if (theme !== null) return { kind: "theme", path: theme };
  return null;
}

function literalValue(input: Node): string | null {
  const node = unwrap(input);
  if (node.type === "Literal") {
    const value = cast<Literal>(node).value;
    return value === null ? null : String(value);
  }
  if (node.type === "TemplateLiteral") {
    const template = cast<TemplateLiteral>(node);
    if (template.expressions.length === 0) {
      const first = template.quasis[0];
      return first ? (first.value.cooked ?? first.value.raw) : "";
    }
  }
  return null;
}
