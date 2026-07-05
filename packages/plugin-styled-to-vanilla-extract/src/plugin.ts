import {
  definePlugin,
  type EmittedFile,
  type FileContext,
  type ProjectContext,
} from "@omnimod/core";
import { ImportManager } from "@omnimod/plugin-utils";
import { rewriteImporters } from "./crossfile.ts";
import { renderMigrationGuide } from "./migration.ts";
import {
  detectStyledImport,
  findCssFragments,
  findGlobalStyles,
  findKeyframes,
  findStyledComponents,
} from "./detect.ts";
import { generateCss } from "./generate.ts";
import { cssPaths, themeFilePath, themeImportSpecifier } from "./naming.ts";
import { removeJsxElement, removeStatement, rewriteUsages } from "./rewrite.ts";
import {
  createState as makeState,
  exportKey,
  type FileConversion,
  type MigrationNote,
  type StyledToVeState,
} from "./state.ts";
import { renderThemeFile } from "./theme.ts";

export type StyledToVeOptions = Record<string, unknown>;

const DEFAULT_STYLED_IMPORT = "__default__";

/**
 * Convert styled-components to vanilla-extract. Handles static & dynamic
 * `styled.tag` (→ style()/recipe() + inline JSX rewrite), `createGlobalStyle`
 * (→ globalStyle()), theme access (→ generated `theme.css.ts` contract), and
 * exported components used across files (repointed imports + rewritten usages).
 * `analyze` builds the export/theme graph; `transform` applies the edits.
 */
export const styledToVanillaExtract = definePlugin<StyledToVeOptions, StyledToVeState>({
  name: "styled-to-vanilla-extract",
  description: "Convert styled-components to vanilla-extract.",
  include: ["**/*.{tsx,jsx,ts,js}"],

  createState: makeState,

  analyze(file: FileContext, project: ProjectContext<StyledToVeState>): void {
    const styledImport = detectStyledImport(file.program);
    if (!styledImport) return;

    const styledLocal = styledImport.styledLocal;
    const createGlobalLocal = styledImport.namedLocals.get("createGlobalStyle");
    const keyframesLocal = styledImport.namedLocals.get("keyframes");
    const cssLocal = styledImport.namedLocals.get("css");
    const styled = styledLocal
      ? findStyledComponents(file.program, styledLocal)
      : { convertible: [], exported: [], skipped: [] };
    const globals = createGlobalLocal
      ? findGlobalStyles(file.program, createGlobalLocal)
      : { convertible: [], skipped: [] };
    const keyframes = keyframesLocal
      ? findKeyframes(file.program, keyframesLocal)
      : { convertible: [], skipped: [] };
    const fragments = cssLocal
      ? findCssFragments(file.program, cssLocal)
      : { convertible: [], skipped: [] };

    const components = [...styled.convertible, ...styled.exported];
    const skippedCount =
      styled.skipped.length +
      globals.skipped.length +
      keyframes.skipped.length +
      fragments.skipped.length;
    // Keep going if there's anything to convert OR anything to report (skips still
    // need to land in MIGRATION.md, even in a file that converted nothing).
    if (
      components.length === 0 &&
      globals.convertible.length === 0 &&
      keyframes.convertible.length === 0 &&
      fragments.convertible.length === 0 &&
      skippedCount === 0
    ) {
      return;
    }

    const themeVars = themeImportSpecifier(file.path, project.root);
    const result = generateCss(
      components,
      globals.convertible,
      keyframes.convertible,
      fragments.convertible,
      themeVars,
      project.state.themePaths,
    );
    const { cssFilePath, importSpecifier } = cssPaths(file.path);
    const exportedNames = new Set(styled.exported.map((component) => component.localName));

    const conversion: FileConversion = {
      result,
      // Only the items whose CSS parsed successfully may be removed from source.
      globals: result.globals,
      keyframes: result.keyframes,
      fragments: result.fragments,
      styledImport,
      skipped: [
        ...styled.skipped,
        ...globals.skipped,
        ...keyframes.skipped,
        ...fragments.skipped,
        ...result.skipped,
      ],
      cssFilePath,
      importSpecifier,
      exportedNames,
    };
    project.state.perFile.set(file.path, conversion);

    const cssBaseNoExt = cssFilePath.replace(/\.ts$/, "");
    for (const entry of result.entries) {
      if (!exportedNames.has(entry.component.localName)) continue;
      project.state.exports.set(exportKey(file.path, entry.component.localName), {
        exportName: entry.component.localName,
        tag: entry.artifact.tag,
        artifact: entry.artifact,
        cssBaseNoExt,
      });
    }
  },

  transform(file: FileContext, project: ProjectContext<StyledToVeState>): void {
    const componentImports = new ImportManager();
    let needsClsx = false;
    let needsAssignInlineVars = false;

    // (A) Rewrite usages of exported components imported from other modules.
    const importer = rewriteImporters(file, project, componentImports);
    needsClsx ||= importer.needsClsx;
    needsAssignInlineVars ||= importer.needsAssignInlineVars;

    // (B) Apply this file's own conversion (local + exported components, globals).
    const conversion = project.state.perFile.get(file.path);
    let convApplied = false;
    if (conversion) {
      reportDiagnostics(file, conversion, project.state.notes);
      convApplied =
        conversion.result.entries.length > 0 ||
        conversion.keyframes.length > 0 ||
        conversion.fragments.length > 0 ||
        conversion.globals.length > 0;
      if (convApplied) {
        applyConversion(file, conversion, componentImports, (usage) => {
          needsClsx ||= usage.needsClsx;
          needsAssignInlineVars ||= usage.needsAssignInlineVars;
        });
      }
    }

    if (!importer.touched && !convApplied) return;

    if (needsClsx) componentImports.addDefault("clsx", "clsx");
    if (needsAssignInlineVars) {
      componentImports.addNamed("@vanilla-extract/dynamic", "assignInlineVars");
    }

    let importBlock = componentImports.render();
    if (
      convApplied &&
      conversion &&
      conversion.globals.length > 0 &&
      conversion.result.entries.length === 0
    ) {
      const sideEffect = `import ${JSON.stringify(conversion.importSpecifier)};`;
      importBlock = importBlock ? `${sideEffect}\n${importBlock}` : sideEffect;
    }

    if (importBlock) file.magic.prepend(`${importBlock}\n\n`);
    if (convApplied && conversion) {
      file.emit({ path: conversion.cssFilePath, contents: conversion.result.contents });
    }
  },

  finalize(project): EmittedFile[] | undefined {
    const emitted: EmittedFile[] = [];
    if (project.state.themePaths.size > 0) {
      emitted.push({
        path: themeFilePath(project.root),
        contents: renderThemeFile(project.state.themePaths),
      });
    }
    if (project.state.notes.length > 0) {
      emitted.push({
        path: `${project.root}/MIGRATION.md`,
        contents: renderMigrationGuide(
          project.state.notes,
          project.root,
          [...project.state.themePaths].sort(),
        ),
      });
    }
    return emitted.length > 0 ? emitted : undefined;
  },
});

/** Report a file's conversion warnings and skips, and record them for MIGRATION.md. */
function reportDiagnostics(
  file: FileContext,
  conversion: FileConversion,
  notes: MigrationNote[],
): void {
  for (const warning of conversion.result.warnings) {
    file.report({ message: warning, severity: "warn" });
    notes.push({ file: file.path, severity: "warn", message: warning });
  }
  for (const skip of conversion.skipped) {
    const message = `Skipped \`${skip.localName}\`: ${skip.reason}`;
    file.report({ message, severity: "warn" });
    notes.push({ file: file.path, severity: "warn", message });
  }
}

function applyConversion(
  file: FileContext,
  conversion: FileConversion,
  componentImports: ImportManager,
  onUsage: (usage: { needsClsx: boolean; needsAssignInlineVars: boolean }) => void,
): void {
  for (const { component, artifact } of conversion.result.entries) {
    removeStatement(file, component.statement);
    const usage = rewriteUsages(
      file,
      { localName: component.localName, tag: artifact.tag },
      artifact,
    );
    // Only import the style into this file when it is actually used here
    // (exported-only components are imported by other files instead).
    if (usage.usageCount > 0) {
      componentImports.addNamed(conversion.importSpecifier, artifact.styleName);
      for (const binding of artifact.varProps) {
        componentImports.addNamed(conversion.importSpecifier, binding.varName);
      }
      for (const composed of artifact.composedStyles) {
        componentImports.addNamed(conversion.importSpecifier, composed.name);
      }
    }
    onUsage(usage);
  }

  for (const global of conversion.globals) {
    removeStatement(file, global.statement);
    removeJsxElement(file, global.localName);
  }

  for (const frames of conversion.keyframes) {
    removeStatement(file, frames.statement);
  }

  for (const fragment of conversion.fragments) {
    removeStatement(file, fragment.statement);
  }

  if (
    isImportFullyHandled(
      conversion.styledImport,
      conversion.result.entries.length,
      conversion.globals.length,
      conversion.keyframes.length,
      conversion.fragments.length,
      conversion.skipped.length,
    )
  ) {
    removeStatement(file, conversion.styledImport.node);
  } else {
    file.report({
      message:
        "Left the styled-components import in place; remove it once remaining usages migrate.",
      severity: "info",
    });
  }
}

/** True when every specifier of the styled-components import was fully migrated. */
function isImportFullyHandled(
  styledImport: FileConversion["styledImport"],
  styledCount: number,
  globalCount: number,
  keyframesCount: number,
  fragmentCount: number,
  skippedCount: number,
): boolean {
  if (skippedCount > 0) return false;

  const imported = new Set<string>();
  if (styledImport.styledLocal) imported.add(DEFAULT_STYLED_IMPORT);
  for (const name of styledImport.namedLocals.keys()) imported.add(name);

  const handled = new Set<string>();
  if (styledCount > 0) handled.add(DEFAULT_STYLED_IMPORT);
  if (globalCount > 0) handled.add("createGlobalStyle");
  if (keyframesCount > 0) handled.add("keyframes");
  if (fragmentCount > 0) handled.add("css");

  return [...imported].every((name) => handled.has(name));
}
