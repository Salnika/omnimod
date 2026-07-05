import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { globby } from "globby";
import MagicString from "magic-string";
import { type FormatResult, formatFiles } from "./format.ts";
import { parseFile } from "./parse.ts";
import type {
  Diagnostic,
  EmittedFile,
  FileChange,
  FileContext,
  Plugin,
  ProjectContext,
  RunOptions,
  RunResult,
} from "./types.ts";

const DEFAULT_INCLUDE = ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"];
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/*.d.ts"];
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
const RESOLVE_INDEX = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/** Best-effort resolution of a relative import specifier to an absolute file path. */
export function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null; // bare/package import — out of scope
  const base = resolvePath(dirname(fromFile), specifier);
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (candidate && existsSync(candidate) && !candidate.endsWith("/")) return candidate;
  }
  for (const index of RESOLVE_INDEX) {
    const candidate = base + index;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface LoadedFile {
  path: string;
  source: string;
  ctx: FileContext;
}

/**
 * Run a single plugin over a project: discover files, parse each once, then
 * drive the analyze → transform → finalize lifecycle. Dry-run by default;
 * pass `write: true` to persist changes and emitted files.
 */
export async function run<Options, State>(
  plugin: Plugin<Options, State>,
  runOptions: RunOptions<Options>,
): Promise<RunResult> {
  const root = resolvePath(runOptions.root);
  const include = runOptions.include ?? plugin.include ?? DEFAULT_INCLUDE;
  const exclude = [...DEFAULT_EXCLUDE, ...(runOptions.exclude ?? plugin.exclude ?? [])];
  const options = runOptions.options ?? ({} as Options);

  const files = await globby(include, {
    cwd: root,
    absolute: true,
    ignore: exclude,
    gitignore: true,
    onlyFiles: true,
  });

  const diagnostics: Diagnostic[] = [];
  const emitted: EmittedFile[] = [];

  const state: State = plugin.createState ? plugin.createState() : ({} as State);
  const project: ProjectContext<State> = {
    root,
    state,
    resolve: resolveImport,
  };

  const loaded: LoadedFile[] = [];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    const parsed = parseFile(path, source);
    const magic = new MagicString(source);
    const ctx: FileContext = {
      path,
      source,
      program: parsed.program,
      comments: parsed.comments,
      magic,
      report: (d) => diagnostics.push({ ...d, file: path }),
      emit: (f) => emitted.push(f),
    };
    loaded.push({ path, source, ctx });
  }

  if (plugin.analyze) {
    for (const { ctx } of loaded) await plugin.analyze(ctx, project, options);
  }

  for (const { ctx } of loaded) await plugin.transform(ctx, project, options);

  if (plugin.finalize) {
    const extra = plugin.finalize(project, options);
    if (extra) emitted.push(...extra);
  }

  const changed: FileChange[] = [];
  for (const { path, source, ctx } of loaded) {
    if (ctx.magic.hasChanged()) {
      changed.push({ path, before: source, after: ctx.magic.toString() });
    }
  }

  let format: FormatResult | undefined;
  if (runOptions.write) {
    const written: string[] = [];
    for (const change of changed) {
      await writeFile(change.path, change.after, "utf8");
      written.push(change.path);
    }
    for (const file of emitted) {
      const abs = isAbsolute(file.path) ? file.path : resolvePath(root, file.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.contents, "utf8");
      written.push(abs);
    }
    // Match the project's conventions by running its own formatter/linter.
    if (runOptions.format !== false && written.length > 0) {
      format = await formatFiles(root, written);
    }
  }

  return { changed, emitted, diagnostics, format };
}
