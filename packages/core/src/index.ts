// @omnimod/core — the codemod engine.
//
// Parse with oxc (UTF-16 offsets), edit with magic-string (formatting-preserving),
// and orchestrate a two-phase (analyze → transform → finalize) plugin lifecycle.

export type {
  Diagnostic,
  EmittedFile,
  FileChange,
  FileContext,
  Node,
  Plugin,
  Program,
  ProjectContext,
  RunOptions,
  RunResult,
  Severity,
} from "./types.ts";

export { langFromPath, parseFile } from "./parse.ts";
export type { Lang, ParsedFile } from "./parse.ts";

export { walk } from "./walk.ts";
export type { Visitor, WalkResult } from "./walk.ts";

export { definePlugin } from "./define.ts";

export { resolveImport, run } from "./runner.ts";

export { detectFixers, formatFiles } from "./format.ts";
export type { Fixer, FormatResult } from "./format.ts";

export { renderDiff, renderEmitted } from "./diff.ts";
