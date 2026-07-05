import { dirname, relative } from "node:path";

const SOURCE_EXTENSION = /\.(tsx|ts|jsx|js|mts|cts|mjs|cjs)$/;

// A distinct name so we never clobber a user's existing `theme.css.ts`.
const THEME_BASENAME = "omnimod-theme.css";

/** Absolute path of the generated shared theme file. */
export function themeFilePath(root: string): string {
  return `${root}/${THEME_BASENAME}.ts`;
}

/** The specifier a file at `fromFile` uses to import the generated theme contract. */
export function themeImportSpecifier(fromFile: string, root: string): string {
  const relativePath = relative(dirname(fromFile), `${root}/${THEME_BASENAME}`)
    .split("\\")
    .join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

/** A component name → its vanilla-extract style export (lower-camel). */
export function styleExportName(componentName: string): string {
  return componentName.charAt(0).toLowerCase() + componentName.slice(1);
}

export interface CssPaths {
  /** Absolute path of the generated `.css.ts` sibling file. */
  cssFilePath: string;
  /** The specifier the component file uses to import it (extension-less). */
  importSpecifier: string;
}

/** Derive the `.css.ts` sibling path and its import specifier from a source file. */
export function cssPaths(filePath: string): CssPaths {
  const base = filePath.replace(SOURCE_EXTENSION, "");
  const slash = base.lastIndexOf("/");
  const baseName = slash >= 0 ? base.slice(slash + 1) : base;
  return {
    cssFilePath: `${base}.css.ts`,
    importSpecifier: `./${baseName}.css`,
  };
}

/** Return `base` unless taken, otherwise `base2`, `base3`, ... Records the pick. */
export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let counter = 2;
  while (used.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  used.add(name);
  return name;
}
