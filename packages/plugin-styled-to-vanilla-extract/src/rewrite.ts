import type { FileContext, Node } from "@omnimod/core";
import { walk } from "@omnimod/core";
import type { StyledArtifact } from "./dynamic.ts";
import {
  cast,
  type ImportDeclaration,
  type JSXAttribute,
  type JSXClosingElement,
  type JSXElement,
  type JSXExpressionContainer,
  type JSXIdentifier,
  type JSXOpeningElement,
} from "@omnimod/plugin-utils";

/** The minimum a JSX rewrite needs: the local binding name and the target tag. */
export interface UsageTarget {
  localName: string;
  tag: string;
}

/** Remove a whole top-level statement, including its trailing newline. */
export function removeStatement(file: FileContext, statement: Node): void {
  let end = statement.end;
  if (file.source[end] === "\n") end += 1;
  file.magic.remove(statement.start, end);
}

/** Remove a single named import specifier (or the whole import if it's the last). */
export function removeImportSpecifier(
  file: FileContext,
  importDecl: ImportDeclaration,
  spec: Node,
): void {
  const specifiers = importDecl.specifiers;
  if (specifiers.length <= 1) {
    removeStatement(file, importDecl);
    return;
  }
  const index = specifiers.indexOf(spec);
  if (index <= 0) {
    file.magic.remove(spec.start, specifiers[1].start);
  } else {
    file.magic.remove(specifiers[index - 1].end, spec.end);
  }
}

export interface UsageRewriteResult {
  /** How many JSX usages were rewritten in this file. */
  usageCount: number;
  /** True when an existing className was merged (needs clsx). */
  needsClsx: boolean;
  /** True when an inline CSS variable was set (needs assignInlineVars). */
  needsAssignInlineVars: boolean;
}

/**
 * Rewrite every JSX usage of a styled component: swap the tag, fold the style /
 * recipe class into `className`, pass variant props to the recipe, and move
 * continuous props into `assignInlineVars`.
 */
export function rewriteUsages(
  file: FileContext,
  component: UsageTarget,
  artifact: StyledArtifact,
): UsageRewriteResult {
  const result: UsageRewriteResult = {
    usageCount: 0,
    needsClsx: false,
    needsAssignInlineVars: false,
  };
  const variantProps = new Set(artifact.variantProps);
  const varByProp = new Map(artifact.varProps.map((binding) => [binding.prop, binding.varName]));

  walk(file.program, (node) => {
    if (node.type === "JSXOpeningElement") {
      const opening = cast<JSXOpeningElement>(node);
      if (jsxNameEquals(opening.name, component.localName)) {
        result.usageCount += 1;
        rewriteOpening(file, opening, component, artifact, variantProps, varByProp, result);
      }
    } else if (node.type === "JSXClosingElement") {
      const closing = cast<JSXClosingElement>(node);
      if (jsxNameEquals(closing.name, component.localName)) {
        file.magic.update(closing.name.start, closing.name.end, component.tag);
      }
    }
  });

  return result;
}

function rewriteOpening(
  file: FileContext,
  opening: JSXOpeningElement,
  component: UsageTarget,
  artifact: StyledArtifact,
  variantProps: Set<string>,
  varByProp: Map<string, string>,
  result: UsageRewriteResult,
): void {
  const source = file.source;
  file.magic.update(opening.name.start, opening.name.end, component.tag);

  let classNameAttr: JSXAttribute | null = null;
  let styleAttr: JSXAttribute | null = null;
  const variantArgs: string[] = [];
  const varAssignments: string[] = [];

  for (const rawAttr of opening.attributes) {
    if (rawAttr.type !== "JSXAttribute") continue; // leave spreads alone
    const attr = cast<JSXAttribute>(rawAttr);
    const name = jsxAttributeName(attr);
    if (name === null) continue;

    if (name === "className") {
      classNameAttr = attr;
    } else if (name === "style") {
      styleAttr = attr;
    } else if (variantProps.has(name)) {
      variantArgs.push(`${name}: ${attrInner(attr, source)}`);
      removeAttribute(file, attr);
    } else {
      const varName = varByProp.get(name);
      if (varName) {
        varAssignments.push(`[${varName}]: ${attrInner(attr, source)}`);
        removeAttribute(file, attr);
      }
    }
  }

  const classCore =
    artifact.kind === "recipe"
      ? `${artifact.styleName}(${variantArgs.length > 0 ? `{ ${variantArgs.join(", ")} }` : "{}"})`
      : artifact.styleName;
  const classParts = [...artifact.composedStyles.map((composed) => composed.expr), classCore];

  if (classNameAttr) {
    result.needsClsx = true;
    file.magic.update(
      classNameAttr.start,
      classNameAttr.end,
      `className={clsx(${classParts.join(", ")}, ${attrInner(classNameAttr, source)})}`,
    );
  } else if (classParts.length > 1) {
    result.needsClsx = true;
    file.magic.appendLeft(opening.name.end, ` className={clsx(${classParts.join(", ")})}`);
  } else {
    file.magic.appendLeft(opening.name.end, ` className={${classParts[0]}}`);
  }

  if (varAssignments.length > 0) {
    result.needsAssignInlineVars = true;
    const vars = `assignInlineVars({ ${varAssignments.join(", ")} })`;
    if (styleAttr) {
      file.magic.update(
        styleAttr.start,
        styleAttr.end,
        `style={{ ...${attrInner(styleAttr, source)}, ...${vars} }}`,
      );
    } else {
      file.magic.appendLeft(opening.name.end, ` style={${vars}}`);
    }
  }
}

function jsxNameEquals(name: Node, local: string): boolean {
  return name.type === "JSXIdentifier" && cast<JSXIdentifier>(name).name === local;
}

function jsxAttributeName(attr: JSXAttribute): string | null {
  return attr.name.type === "JSXIdentifier" ? cast<JSXIdentifier>(attr.name).name : null;
}

/** The source expression of an attribute value (`"foo"`, `x`, or `true` for a bare flag). */
function attrInner(attr: JSXAttribute, source: string): string {
  if (attr.value && attr.value.type === "JSXExpressionContainer") {
    const expression = cast<JSXExpressionContainer>(attr.value).expression;
    return source.slice(expression.start, expression.end);
  }
  if (attr.value) return source.slice(attr.value.start, attr.value.end);
  return "true";
}

/** Remove an attribute along with the single whitespace character before it. */
function removeAttribute(file: FileContext, attr: JSXAttribute): void {
  let start = attr.start;
  const before = file.source[start - 1];
  if (before === " " || before === "\n" || before === "\t") start -= 1;
  file.magic.remove(start, attr.end);
}

/** Remove every `<Name … />` / `<Name>…</Name>` element (used for createGlobalStyle). */
export function removeJsxElement(file: FileContext, localName: string): number {
  let removed = 0;
  walk(file.program, (node) => {
    if (node.type !== "JSXElement") return;
    const element = cast<JSXElement>(node);
    if (jsxNameEquals(element.openingElement.name, localName)) {
      file.magic.remove(node.start, node.end);
      removed += 1;
      return "skip";
    }
  });
  return removed;
}
