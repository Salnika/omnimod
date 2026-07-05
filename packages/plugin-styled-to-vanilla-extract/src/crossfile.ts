import { dirname, relative } from "node:path";
import type { FileContext, ProjectContext } from "@omnimod/core";
import {
  cast,
  type Identifier,
  type ImportDeclaration,
  type ImportManager,
  type ImportSpecifier,
} from "@omnimod/plugin-utils";
import { removeImportSpecifier, removeStatement, rewriteUsages } from "./rewrite.ts";
import { exportKey, type StyledToVeState } from "./state.ts";

function cssSpecifierFrom(importerFile: string, cssBaseNoExt: string): string {
  const relativePath = relative(dirname(importerFile), cssBaseNoExt).split("\\").join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

export interface ImporterResult {
  touched: boolean;
  needsClsx: boolean;
  needsAssignInlineVars: boolean;
}

/**
 * Rewrite JSX usages of exported styled components imported from other modules,
 * and repoint each such named import at the generated css style/recipe.
 */
export function rewriteImporters(
  file: FileContext,
  project: ProjectContext<StyledToVeState>,
  componentImports: ImportManager,
): ImporterResult {
  const result: ImporterResult = { touched: false, needsClsx: false, needsAssignInlineVars: false };

  for (const stmt of file.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const importDecl = cast<ImportDeclaration>(stmt);
    const resolved = project.resolve(file.path, importDecl.source.value);
    if (!resolved) continue;

    const matched = importDecl.specifiers.filter((spec) => {
      if (spec.type !== "ImportSpecifier") return false;
      const specifier = cast<ImportSpecifier>(spec);
      const importedName = cast<Identifier>(specifier.imported).name;
      const entry = project.state.exports.get(exportKey(resolved, importedName));
      if (!entry) return false;

      const usage = rewriteUsages(
        file,
        { localName: specifier.local.name, tag: entry.tag },
        entry.artifact,
      );
      // Repoint the (now-invalid) import even if unused here, but only pull in
      // the css style when there is a usage that references it.
      if (usage.usageCount > 0) {
        const cssSpec = cssSpecifierFrom(file.path, entry.cssBaseNoExt);
        componentImports.addNamed(cssSpec, entry.artifact.styleName);
        for (const binding of entry.artifact.varProps) {
          componentImports.addNamed(cssSpec, binding.varName);
        }
        for (const composed of entry.artifact.composedStyles) {
          componentImports.addNamed(cssSpec, composed.name);
        }
        result.needsClsx ||= usage.needsClsx;
        result.needsAssignInlineVars ||= usage.needsAssignInlineVars;
      }
      result.touched = true;
      return true;
    });

    if (matched.length === 0) continue;
    if (matched.length === importDecl.specifiers.length) {
      removeStatement(file, importDecl);
    } else {
      for (const spec of matched) removeImportSpecifier(file, importDecl, spec);
    }
  }

  return result;
}
