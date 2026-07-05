import type { Node, Program } from "@omnimod/core";
import {
  type CallExpression,
  cast,
  type Identifier,
  type ImportDeclaration,
  type ImportDefaultSpecifier,
  type ImportSpecifier,
  type MemberExpression,
  type TaggedTemplateExpression,
  type VariableDeclaration,
} from "@omnimod/plugin-utils";

export interface StyledImport {
  node: ImportDeclaration;
  /** Local name of the default `styled` import, if any. */
  styledLocal: string | null;
  /** Named imports: imported name → local name (css, keyframes, createGlobalStyle). */
  namedLocals: Map<string, string>;
  /** True when the import only brings in the default `styled`. */
  onlyDefault: boolean;
}

/** Find the `styled-components` import in a module, if present. */
export function detectStyledImport(program: Program): StyledImport | null {
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const imp = cast<ImportDeclaration>(stmt);
    if (imp.source.value !== "styled-components") continue;

    let styledLocal: string | null = null;
    const namedLocals = new Map<string, string>();
    for (const spec of imp.specifiers) {
      if (spec.type === "ImportDefaultSpecifier") {
        styledLocal = cast<ImportDefaultSpecifier>(spec).local.name;
      } else if (spec.type === "ImportSpecifier") {
        const s = cast<ImportSpecifier>(spec);
        namedLocals.set(cast<Identifier>(s.imported).name, s.local.name);
      }
    }
    return {
      node: imp,
      styledLocal,
      namedLocals,
      onlyDefault: styledLocal !== null && namedLocals.size === 0,
    };
  }
  return null;
}

export interface StyledComponent {
  /** The local identifier, e.g. `Card`. */
  localName: string;
  /** The intrinsic HTML tag (`div`); empty for `styled(Base)` until base resolves. */
  tag: string;
  /** For `styled(Base)`: the base component's local name. */
  baseName?: string;
  /** The whole statement to remove (VariableDeclaration). */
  statement: Node;
  /** The template's static chunks (length N+1 for N interpolations). */
  quasis: string[];
  /** The interpolation expressions (empty for a static template). */
  expressions: Node[];
}

export interface SkippedComponent {
  reason: string;
  localName: string;
}

export interface FindResult {
  /** Local (non-exported) styled.tag components — rewritten in place. */
  convertible: StyledComponent[];
  /** Exported styled.tag components — rewritten and registered for cross-file use. */
  exported: StyledComponent[];
  skipped: SkippedComponent[];
}

/**
 * Find `const X = styled.tag`...`` declarations (static or dynamic). Local and
 * exported single-declarator `styled.tag` forms are convertible (exported ones
 * feed the cross-file registry); composed (`styled(Component)`) forms are skipped.
 */
export function findStyledComponents(program: Program, styledLocal: string): FindResult {
  const convertible: StyledComponent[] = [];
  const exportedList: StyledComponent[] = [];
  const skipped: SkippedComponent[] = [];

  for (const stmt of program.body) {
    let varDecl: VariableDeclaration | null = null;
    let exported = false;
    if (stmt.type === "VariableDeclaration") {
      varDecl = cast<VariableDeclaration>(stmt);
    } else if (stmt.type === "ExportNamedDeclaration") {
      const decl = (stmt as { declaration?: Node | null }).declaration;
      if (decl && decl.type === "VariableDeclaration") {
        varDecl = cast<VariableDeclaration>(decl);
        exported = true;
      }
    }
    if (!varDecl) continue;

    for (const declarator of varDecl.declarations) {
      if (!declarator.init || declarator.init.type !== "TaggedTemplateExpression") continue;
      const tagged = cast<TaggedTemplateExpression>(declarator.init);
      const tag = styledTag(tagged.tag, styledLocal);
      const baseName = tag === null ? styledBase(tagged.tag, styledLocal) : null;
      const localName = cast<Identifier>(declarator.id).name;

      if (tag === null && baseName === null) {
        if (usesStyled(tagged.tag, styledLocal)) {
          skipped.push({ reason: "styled(...).attrs / `as` is not supported yet", localName });
        }
        continue;
      }
      if (varDecl.declarations.length !== 1) {
        skipped.push({ reason: "multiple declarators in one statement", localName });
        continue;
      }
      const quasis = tagged.quasi.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
      const component: StyledComponent = {
        localName,
        tag: tag ?? "",
        baseName: baseName ?? undefined,
        statement: stmt,
        quasis,
        expressions: tagged.quasi.expressions,
      };
      (exported ? exportedList : convertible).push(component);
    }
  }

  return { convertible, exported: exportedList, skipped };
}

export interface GlobalStyleConst {
  localName: string;
  statement: Node;
  cssText: string;
}

export interface FindGlobalsResult {
  convertible: GlobalStyleConst[];
  skipped: SkippedComponent[];
}

/**
 * Find `const X = createGlobalStyle`...`` declarations. Only local, static,
 * single-declarator forms are convertible.
 */
export function findGlobalStyles(program: Program, createGlobalLocal: string): FindGlobalsResult {
  const convertible: GlobalStyleConst[] = [];
  const skipped: SkippedComponent[] = [];

  for (const stmt of program.body) {
    let varDecl: VariableDeclaration | null = null;
    let exported = false;
    if (stmt.type === "VariableDeclaration") {
      varDecl = cast<VariableDeclaration>(stmt);
    } else if (stmt.type === "ExportNamedDeclaration") {
      const decl = (stmt as { declaration?: Node | null }).declaration;
      if (decl && decl.type === "VariableDeclaration") {
        varDecl = cast<VariableDeclaration>(decl);
        exported = true;
      }
    }
    if (!varDecl) continue;

    for (const declarator of varDecl.declarations) {
      if (!declarator.init || declarator.init.type !== "TaggedTemplateExpression") continue;
      const tagged = cast<TaggedTemplateExpression>(declarator.init);
      if (tagged.tag.type !== "Identifier") continue;
      if (cast<Identifier>(tagged.tag).name !== createGlobalLocal) continue;

      const localName = cast<Identifier>(declarator.id).name;
      if (exported) {
        skipped.push({ reason: "exported createGlobalStyle (comes later)", localName });
        continue;
      }
      if (tagged.quasi.expressions.length > 0) {
        skipped.push({
          reason: "dynamic createGlobalStyle interpolation (comes later)",
          localName,
        });
        continue;
      }
      const cssText = tagged.quasi.quasis
        .map((quasi) => quasi.value.cooked ?? quasi.value.raw)
        .join("");
      convertible.push({ localName, statement: stmt, cssText });
    }
  }

  return { convertible, skipped };
}

export interface KeyframesConst {
  localName: string;
  statement: Node;
  cssText: string;
}

export interface FindKeyframesResult {
  convertible: KeyframesConst[];
  skipped: SkippedComponent[];
}

/** Find `const X = keyframes`...`` declarations (local, static). */
export function findKeyframes(program: Program, keyframesLocal: string): FindKeyframesResult {
  const convertible: KeyframesConst[] = [];
  const skipped: SkippedComponent[] = [];

  for (const stmt of program.body) {
    let varDecl: VariableDeclaration | null = null;
    let exported = false;
    if (stmt.type === "VariableDeclaration") {
      varDecl = cast<VariableDeclaration>(stmt);
    } else if (stmt.type === "ExportNamedDeclaration") {
      const decl = (stmt as { declaration?: Node | null }).declaration;
      if (decl && decl.type === "VariableDeclaration") {
        varDecl = cast<VariableDeclaration>(decl);
        exported = true;
      }
    }
    if (!varDecl) continue;

    for (const declarator of varDecl.declarations) {
      if (!declarator.init || declarator.init.type !== "TaggedTemplateExpression") continue;
      const tagged = cast<TaggedTemplateExpression>(declarator.init);
      if (tagged.tag.type !== "Identifier") continue;
      if (cast<Identifier>(tagged.tag).name !== keyframesLocal) continue;

      const localName = cast<Identifier>(declarator.id).name;
      if (exported || tagged.quasi.expressions.length > 0) {
        skipped.push({ reason: "exported or dynamic keyframes (comes later)", localName });
        continue;
      }
      const cssText = tagged.quasi.quasis
        .map((quasi) => quasi.value.cooked ?? quasi.value.raw)
        .join("");
      convertible.push({ localName, statement: stmt, cssText });
    }
  }

  return { convertible, skipped };
}

export interface CssFragmentConst {
  localName: string;
  statement: Node;
  quasis: string[];
  expressions: Node[];
}

export interface FindFragmentsResult {
  convertible: CssFragmentConst[];
  skipped: SkippedComponent[];
}

/** Find `const X = css`...`` shared-style fragments (local). */
export function findCssFragments(program: Program, cssLocal: string): FindFragmentsResult {
  const convertible: CssFragmentConst[] = [];
  const skipped: SkippedComponent[] = [];

  for (const stmt of program.body) {
    let varDecl: VariableDeclaration | null = null;
    let exported = false;
    if (stmt.type === "VariableDeclaration") {
      varDecl = cast<VariableDeclaration>(stmt);
    } else if (stmt.type === "ExportNamedDeclaration") {
      const decl = (stmt as { declaration?: Node | null }).declaration;
      if (decl && decl.type === "VariableDeclaration") {
        varDecl = cast<VariableDeclaration>(decl);
        exported = true;
      }
    }
    if (!varDecl) continue;

    for (const declarator of varDecl.declarations) {
      if (!declarator.init || declarator.init.type !== "TaggedTemplateExpression") continue;
      const tagged = cast<TaggedTemplateExpression>(declarator.init);
      if (tagged.tag.type !== "Identifier") continue;
      if (cast<Identifier>(tagged.tag).name !== cssLocal) continue;

      const localName = cast<Identifier>(declarator.id).name;
      if (exported) {
        skipped.push({ reason: "exported css fragment (comes later)", localName });
        continue;
      }
      const quasis = tagged.quasi.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
      convertible.push({
        localName,
        statement: stmt,
        quasis,
        expressions: tagged.quasi.expressions,
      });
    }
  }

  return { convertible, skipped };
}

/** For `styled(Base)` (a plain call, not `.attrs`), the base component's name. */
function styledBase(tag: Node, styledLocal: string): string | null {
  if (tag.type !== "CallExpression") return null;
  const call = cast<CallExpression>(tag);
  if (call.callee.type !== "Identifier") return null;
  if (cast<Identifier>(call.callee).name !== styledLocal) return null;
  const arg = call.arguments[0];
  if (!arg || arg.type !== "Identifier") return null;
  return cast<Identifier>(arg).name;
}

/** Whether a tag expression is rooted at the `styled` import (styled(...) / .attrs). */
function usesStyled(node: Node, styledLocal: string): boolean {
  if (node.type === "Identifier") return cast<Identifier>(node).name === styledLocal;
  if (node.type === "MemberExpression") {
    return usesStyled(cast<MemberExpression>(node).object, styledLocal);
  }
  if (node.type === "CallExpression") {
    return usesStyled(cast<CallExpression>(node).callee, styledLocal);
  }
  return false;
}

/** Return the HTML tag for a `styled.tag` member expression, else null. */
function styledTag(tag: Node, styledLocal: string): string | null {
  if (tag.type !== "MemberExpression") return null;
  const member = cast<MemberExpression>(tag);
  if (member.object.type !== "Identifier") return null;
  if (cast<Identifier>(member.object).name !== styledLocal) return null;
  if (member.computed || member.property.type !== "Identifier") return null;
  const tagName = cast<Identifier>(member.property).name;
  // Only intrinsic (lowercase) elements; `styled(Component)` is handled elsewhere.
  return /^[a-z][a-z0-9]*$/.test(tagName) ? tagName : null;
}
