import type { AtRule, ChildNode, Container, Declaration, Root, Rule } from "postcss";
import scss from "postcss-scss";
import { cssPropToCamel } from "./casing.ts";
import { type VeEntry, type VeValue, veNumber, veObject, veRaw, veString } from "./ve.ts";

const PLACEHOLDER_PREFIX = "__OMNIMOD_EXPR_";
const SINGLE_PLACEHOLDER = /^__OMNIMOD_EXPR_(\d+)__$/;
const PLACEHOLDER_GLOBAL = /__OMNIMOD_EXPR_\d+__/g;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;
const DESCENDANT_COMBINATORS = [" ", "\t", "\n", ">", "+", "~"];

/** The token inserted where interpolation `index` sat in a styled template. */
export function placeholderToken(index: number): string {
  return `${PLACEHOLDER_PREFIX}${index}__`;
}

/**
 * Reconstruct a parseable CSS string from a styled template's static chunks,
 * inserting an identifier-like placeholder token between each pair (one per
 * interpolation). `quasis` has length N+1 for N interpolations.
 */
export function buildPlaceholderCss(quasis: string[]): string {
  let css = "";
  for (let i = 0; i < quasis.length; i++) {
    css += quasis[i];
    if (i < quasis.length - 1) css += placeholderToken(i);
  }
  return css;
}

export function parseScss(css: string): Root {
  return scss.parse(css);
}

/**
 * Resolve an interpolation placeholder to a vanilla-extract value. `context`
 * tells the resolver where the placeholder appeared. Returning `null` means the
 * interpolation could not be converted (the caller records a warning).
 */
export type PlaceholderResolver = (
  token: string,
  context: "value" | "property" | "selector",
) => VeValue | null;

/** A selector that must become `globalStyle(...)`; `selector` keeps `&` as the component placeholder. */
export interface DescendantRule {
  selector: string;
  style: VeValue;
}

export interface VeStyleResult {
  /** The object for `style({...})` (declarations, pseudos via `selectors`, `@media`). */
  base: VeValue;
  /** Selectors that can't live inside `style()` and need `globalStyle()`. */
  descendants: DescendantRule[];
  /** Human-readable notes about anything that couldn't be fully converted. */
  warnings: string[];
}

/** Convert a parsed styled-components CSS block into a vanilla-extract style model. */
export function cssToVeStyle(root: Root, resolve?: PlaceholderResolver): VeStyleResult {
  const descendants: DescendantRule[] = [];
  const warnings: string[] = [];
  const base = convertContainer(root, resolve, descendants, warnings);
  return { base, descendants, warnings };
}

/**
 * Convert a `keyframes` CSS block into the object vanilla-extract's `keyframes()`
 * expects, keyed by step (`from`, `to`, `0%`, `50%`, …).
 */
export function keyframesToVe(root: Root): VeValue {
  const steps: VeEntry[] = [];
  const scratchDescendants: DescendantRule[] = [];
  const scratchWarnings: string[] = [];

  root.each((node) => {
    if (node.type !== "rule") return;
    const inner = convertContainer(node, undefined, scratchDescendants, scratchWarnings);
    for (const rawStep of splitTopLevel(node.selector, [","])) {
      const step = normalizeSelector(rawStep);
      if (step.length > 0) steps.push({ key: step, value: inner });
    }
  });

  return veObject(steps);
}

/**
 * Convert a `createGlobalStyle`/global CSS block into a flat list of
 * `globalStyle(selector, style)` rules (one per top-level selector).
 */
export function globalRules(root: Root): DescendantRule[] {
  const rules: DescendantRule[] = [];
  const scratchDescendants: DescendantRule[] = [];
  const scratchWarnings: string[] = [];

  root.each((node) => {
    if (node.type !== "rule") return;
    const inner = convertContainer(node, undefined, scratchDescendants, scratchWarnings);
    for (const rawSelector of splitTopLevel(node.selector, [","])) {
      const selector = normalizeSelector(rawSelector);
      if (selector.length > 0) rules.push({ selector, style: inner });
    }
  });

  return rules;
}

function convertContainer(
  container: Container,
  resolve: PlaceholderResolver | undefined,
  descendants: DescendantRule[],
  warnings: string[],
): VeValue {
  const entries: VeEntry[] = [];
  const selectorEntries: VeEntry[] = [];
  const mediaEntries: VeEntry[] = [];

  container.each((node: ChildNode) => {
    if (node.type === "decl") {
      entries.push(declToEntry(node, resolve, warnings));
    } else if (node.type === "rule") {
      classifyRule(node, resolve, descendants, warnings, selectorEntries);
    } else if (node.type === "atrule") {
      handleAtRule(node, resolve, descendants, warnings, mediaEntries);
    }
  });

  if (selectorEntries.length > 0) {
    entries.push({ key: "selectors", value: veObject(selectorEntries) });
  }
  if (mediaEntries.length > 0) {
    entries.push({ key: "@media", value: veObject(mediaEntries) });
  }
  return veObject(entries);
}

function handleAtRule(
  atrule: AtRule,
  resolve: PlaceholderResolver | undefined,
  descendants: DescendantRule[],
  warnings: string[],
  mediaEntries: VeEntry[],
): void {
  if (atrule.name === "media") {
    const inner = convertContainer(atrule, resolve, descendants, warnings);
    mediaEntries.push({ key: atrule.params, value: inner });
  } else {
    // keyframes / font-face / supports are handled by the plugin, not here.
    warnings.push(`Unsupported at-rule @${atrule.name} was left unconverted`);
  }
}

function classifyRule(
  rule: Rule,
  resolve: PlaceholderResolver | undefined,
  descendants: DescendantRule[],
  warnings: string[],
  selectorEntries: VeEntry[],
): void {
  const inner = convertContainer(rule, resolve, descendants, warnings);
  for (const rawSelector of splitTopLevel(rule.selector, [","])) {
    const selector = normalizeSelector(rawSelector);
    if (selector.length === 0) continue;

    if (lastCompound(selector).includes("&")) {
      // The rule targets the component itself (`&:hover`, `&.active`, `.parent &`).
      selectorEntries.push({ key: selector, value: inner });
    } else {
      // The rule targets a descendant (`& .child`, `> svg`, bare `a`) → globalStyle.
      const withAmp = selector.includes("&") ? selector : `& ${selector}`;
      descendants.push({ selector: withAmp, style: inner });
    }
  }
}

function declToEntry(
  decl: Declaration,
  resolve: PlaceholderResolver | undefined,
  warnings: string[],
): VeEntry {
  const key = decl.prop.includes(PLACEHOLDER_PREFIX)
    ? resolvePropName(decl.prop, resolve, warnings)
    : cssPropToCamel(decl.prop);
  const rawValue = decl.important ? `${decl.value} !important` : decl.value;
  return { key, value: valueToVe(rawValue, resolve, warnings) };
}

function resolvePropName(
  prop: string,
  resolve: PlaceholderResolver | undefined,
  warnings: string[],
): string {
  const match = SINGLE_PLACEHOLDER.exec(prop.trim());
  if (match && resolve) {
    const resolved = resolve(prop.trim(), "property");
    if (resolved && resolved.kind === "string") return resolved.value;
  }
  warnings.push(`Could not statically convert dynamic property name: ${prop}`);
  return cssPropToCamel(prop);
}

function valueToVe(
  raw: string,
  resolve: PlaceholderResolver | undefined,
  warnings: string[],
): VeValue {
  const value = raw.trim();
  if (!value.includes(PLACEHOLDER_PREFIX)) {
    return NUMERIC.test(value) ? veNumber(Number(value)) : veString(value);
  }
  if (resolve) {
    if (SINGLE_PLACEHOLDER.test(value)) {
      const resolved = resolve(value, "value");
      if (resolved) return resolved;
    } else {
      // Mixed value like `solid 1px ${color}` → a template literal.
      const template = mixedValueToTemplate(value, resolve);
      if (template !== null) return veRaw(template);
    }
  }
  warnings.push(`Could not statically convert dynamic value: ${value}`);
  return veString(value);
}

/** Build a JS template-literal source for a value mixing static text and interpolations. */
function mixedValueToTemplate(value: string, resolve: PlaceholderResolver): string | null {
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of value.matchAll(PLACEHOLDER_GLOBAL)) {
    parts.push(escapeTemplate(value.slice(lastIndex, match.index)));
    const resolved = resolve(match[0], "value");
    if (!resolved) return null;
    parts.push(embedInTemplate(resolved));
    lastIndex = match.index + match[0].length;
  }
  parts.push(escapeTemplate(value.slice(lastIndex)));
  return `\`${parts.join("")}\``;
}

function embedInTemplate(value: VeValue): string {
  switch (value.kind) {
    case "raw":
      return `\${${value.code}}`;
    case "string":
      return escapeTemplate(value.value);
    case "number":
    case "boolean":
      return String(value.value);
    default:
      return "";
  }
}

function escapeTemplate(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** The subject of a selector = its last compound (after descendant combinators). */
function lastCompound(selector: string): string {
  const parts = splitTopLevel(selector, DESCENDANT_COMBINATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : selector;
}

/** Split on any of `seps` at bracket/paren depth 0. */
function splitTopLevel(input: string, seps: string[]): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of input) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);

    if (depth === 0 && seps.includes(char)) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}
