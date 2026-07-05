import type MagicString from "magic-string";
import type { FormatResult } from "./format.ts";

/**
 * A parsed AST node. oxc-parser emits ESTree-compatible nodes; we type them
 * structurally so plugins can navigate freely while keeping `type`/`start`/`end`
 * strongly typed. Byte offsets are UTF-16 code-unit indices (JS string indices),
 * so they can be fed directly to magic-string.
 */
export interface Node {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export interface Program extends Node {
  type: "Program";
  body: Node[];
}

export type Severity = "info" | "warn" | "error";

export interface Diagnostic {
  message: string;
  severity: Severity;
  /** Absolute path of the file the diagnostic refers to. */
  file: string;
  /** 1-based line number, when known. */
  line?: number;
}

export interface EmittedFile {
  /** Path of the file to create (absolute, or relative to the run root). */
  path: string;
  contents: string;
}

/** Everything a plugin needs to inspect and rewrite a single file. */
export interface FileContext {
  /** Absolute path of the file being processed. */
  path: string;
  /** Original, unmodified source text. */
  source: string;
  /** Parsed program (oxc AST). */
  program: Program;
  /** Comments collected by the parser. */
  comments: Node[];
  /**
   * Edit buffer. Mutate this via overwrite/appendLeft/remove to change the file;
   * untouched regions keep their exact original formatting.
   */
  magic: MagicString;
  /** Report a diagnostic (warning / manual follow-up). */
  report(diagnostic: Omit<Diagnostic, "file">): void;
  /** Emit a new generated file (e.g. a sibling `.css.ts`). */
  emit(file: EmittedFile): void;
}

/** Shared, cross-file context. `state` is the plugin's own reduce target. */
export interface ProjectContext<State = unknown> {
  /** Absolute project root. */
  root: string;
  /** Plugin-defined shared store, typically populated during `analyze`. */
  state: State;
  /** Resolve a relative import specifier to an absolute path (best-effort). */
  resolve(fromFile: string, specifier: string): string | null;
}

/**
 * A codemod plugin. The lifecycle is a two-phase map/reduce so plugins can do
 * cross-file work: `analyze` runs over every file first (collecting facts into
 * `state`), then `transform` runs over every file (rewriting using that state),
 * then `finalize` may emit shared files.
 */
export interface Plugin<Options = Record<string, unknown>, State = unknown> {
  name: string;
  description?: string;
  /** Glob patterns of files to include (relative to root). */
  include?: string[];
  /** Glob patterns to exclude. */
  exclude?: string[];
  /** Create the initial shared state. Defaults to `{}`. */
  createState?(): State;
  /** Optional first pass: collect cross-file facts into `project.state`. */
  analyze?(
    file: FileContext,
    project: ProjectContext<State>,
    options: Options,
  ): void | Promise<void>;
  /** Main pass: mutate `file.magic` and/or `file.emit(...)`. */
  transform(
    file: FileContext,
    project: ProjectContext<State>,
    options: Options,
  ): void | Promise<void>;
  /** Optional final pass: emit shared files (e.g. `theme.css.ts`). */
  finalize?(project: ProjectContext<State>, options: Options): EmittedFile[] | void;
}

export interface RunOptions<Options = Record<string, unknown>> {
  /** Absolute or relative project root to operate on. */
  root: string;
  /** Override the plugin's include globs. */
  include?: string[];
  /** Additional exclude globs. */
  exclude?: string[];
  /** When true, write changes to disk; otherwise this is a dry-run. */
  write?: boolean;
  /**
   * Run the project's own formatter/linter `--fix` on the written files so output
   * matches its conventions. Defaults to true; only runs in write mode.
   */
  format?: boolean;
  /** Options forwarded to the plugin. */
  options?: Options;
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
}

export interface RunResult {
  /** Files whose contents changed. */
  changed: FileChange[];
  /** Newly created files. */
  emitted: EmittedFile[];
  /** Warnings and manual-follow-up notes. */
  diagnostics: Diagnostic[];
  /** Formatters run on the written files (write mode only). */
  format?: FormatResult;
}
