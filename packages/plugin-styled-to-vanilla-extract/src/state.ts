import type {
  CssFragmentConst,
  GlobalStyleConst,
  KeyframesConst,
  SkippedComponent,
  StyledImport,
} from "./detect.ts";
import type { StyledArtifact } from "./dynamic.ts";
import type { GeneratedCss } from "./generate.ts";

interface ExportedEntry {
  exportName: string;
  tag: string;
  artifact: StyledArtifact;
  /** Absolute path of the generated css module without `.ts` (e.g. /abs/Button.css). */
  cssBaseNoExt: string;
}

/** A definition file's conversion, computed in `analyze`, applied in `transform`. */
export interface FileConversion {
  result: GeneratedCss;
  globals: GlobalStyleConst[];
  keyframes: KeyframesConst[];
  fragments: CssFragmentConst[];
  styledImport: StyledImport;
  skipped: SkippedComponent[];
  cssFilePath: string;
  importSpecifier: string;
  /** Local names that are exported (registered for cross-file use). */
  exportedNames: Set<string>;
}

/** A manual-follow-up item collected during conversion (feeds MIGRATION.md). */
export interface MigrationNote {
  /** Absolute path of the file the note refers to. */
  file: string;
  severity: "warn" | "info";
  message: string;
}

export interface StyledToVeState {
  /** Union of theme token paths accessed across the project. */
  themePaths: Set<string>;
  /** Exported styled components, keyed by `${absDefinitionFile}#${exportName}`. */
  exports: Map<string, ExportedEntry>;
  /** Per-definition-file conversions. */
  perFile: Map<string, FileConversion>;
  /** Everything that couldn't be fully converted, for the migration guide. */
  notes: MigrationNote[];
}

export function createState(): StyledToVeState {
  return { themePaths: new Set(), exports: new Map(), perFile: new Map(), notes: [] };
}

export function exportKey(definitionFile: string, exportName: string): string {
  return `${definitionFile}#${exportName}`;
}
