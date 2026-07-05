import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHUNK_SIZE = 80;

export interface Fixer {
  /** Display name, e.g. "prettier". */
  tool: string;
  /** Resolved absolute path of the binary. */
  bin: string;
  /** Build the argv for a batch of files. */
  args: (files: string[]) => string[];
}

export interface FormatResult {
  /** Tools that were invoked (in order). */
  tools: string[];
  /** Non-fatal notes (formatting is best-effort; the files are already written). */
  errors: string[];
}

const CONFIG_FILES = {
  biome: ["biome.json", "biome.jsonc"],
  prettier: [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.json5",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.ts",
    ".prettierrc.toml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    "prettier.config.ts",
  ],
  dprint: ["dprint.json", ".dprint.json", "dprint.jsonc"],
  eslint: [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
  ],
} as const;

/** Walk from `root` up to the filesystem root, calling `check` on each directory. */
function walkUp(root: string, check: (dir: string) => boolean): boolean {
  let dir = root;
  for (;;) {
    if (check(dir)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function hasConfig(root: string, names: readonly string[]): boolean {
  return walkUp(root, (dir) => names.some((name) => existsSync(join(dir, name))));
}

function hasPackageJsonKey(root: string, key: string): boolean {
  return walkUp(root, (dir) => {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return false;
    try {
      return key in (JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>);
    } catch {
      return false;
    }
  });
}

function findBin(root: string, bin: string): string | null {
  let found: string | null = null;
  walkUp(root, (dir) => {
    const candidate = join(dir, "node_modules", ".bin", bin);
    if (existsSync(candidate)) {
      found = candidate;
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Detect the project's own formatter/linter fixers so generated code matches the
 * project's conventions (quotes, semicolons, indentation, import order, …).
 * Biome is all-in-one; otherwise eslint --fix (lint) then prettier/dprint (format).
 */
export function detectFixers(root: string): Fixer[] {
  const biome = findBin(root, "biome");
  if (biome && hasConfig(root, CONFIG_FILES.biome)) {
    return [
      {
        tool: "biome",
        bin: biome,
        args: (files) => ["check", "--write", "--files-ignore-unknown=true", ...files],
      },
    ];
  }

  const fixers: Fixer[] = [];

  const eslint = findBin(root, "eslint");
  if (eslint && (hasConfig(root, CONFIG_FILES.eslint) || hasPackageJsonKey(root, "eslintConfig"))) {
    fixers.push({
      tool: "eslint",
      bin: eslint,
      args: (files) => ["--fix", "--no-error-on-unmatched-pattern", ...files],
    });
  }

  const prettier = findBin(root, "prettier");
  if (prettier && (hasConfig(root, CONFIG_FILES.prettier) || hasPackageJsonKey(root, "prettier"))) {
    fixers.push({
      tool: "prettier",
      bin: prettier,
      args: (files) => ["--write", "--ignore-unknown", ...files],
    });
  } else {
    const dprint = findBin(root, "dprint");
    if (dprint && hasConfig(root, CONFIG_FILES.dprint)) {
      fixers.push({ tool: "dprint", bin: dprint, args: (files) => ["fmt", ...files] });
    }
  }

  return fixers;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Run the project's detected fixers over the given files (best-effort — a fixer
 * that exits non-zero, e.g. eslint with remaining lint errors, still counts as run).
 */
export async function formatFiles(root: string, files: string[]): Promise<FormatResult> {
  const tools: string[] = [];
  const errors: string[] = [];
  if (files.length === 0) return { tools, errors };

  for (const fixer of detectFixers(root)) {
    tools.push(fixer.tool);
    for (const batch of chunk(files, CHUNK_SIZE)) {
      try {
        await execFileAsync(fixer.bin, fixer.args(batch), {
          cwd: root,
          maxBuffer: 32 * 1024 * 1024,
          timeout: 180_000,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
        errors.push(`${fixer.tool}: ${message}`);
      }
    }
  }

  return { tools, errors };
}
