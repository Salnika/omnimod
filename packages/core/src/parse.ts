import { parseSync } from "oxc-parser";
import type { Node, Program } from "./types.ts";

export interface ParsedFile {
  program: Program;
  comments: Node[];
  /** Parser errors (oxc reports rather than throws). Empty when the file is valid. */
  errors: unknown[];
}

export type Lang = "js" | "jsx" | "ts" | "tsx";

/** Pick an oxc language mode from a file path. `.js`/`.jsx` allow JSX for safety. */
export function langFromPath(path: string): Lang {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts") || path.endsWith(".mts") || path.endsWith(".cts")) return "ts";
  // Treat plain JS as JSX-permissive: many codebases put JSX in `.js`.
  return "jsx";
}

export function parseFile(path: string, source: string): ParsedFile {
  const result = parseSync(path, source, {
    lang: langFromPath(path),
    sourceType: "module",
  });
  return {
    program: result.program as unknown as Program,
    comments: (result.comments ?? []) as unknown as Node[],
    errors: result.errors ?? [],
  };
}
