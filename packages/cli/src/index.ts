#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  detectFixers,
  type Plugin,
  renderDiff,
  renderEmitted,
  run,
  type RunResult,
} from "@omnimod/core";
import { jestToVitest } from "@omnimod/plugin-jest-to-vitest";
import { lodashToEsToolkit } from "@omnimod/plugin-lodash-to-es-toolkit";
import { momentToDayjs } from "@omnimod/plugin-moment-to-dayjs";
import { reactClassToHooks } from "@omnimod/plugin-react-class-to-hooks";
import { reduxToToolkit } from "@omnimod/plugin-redux-to-toolkit";
import { styledToVanillaExtract } from "@omnimod/plugin-styled-to-vanilla-extract";
import { webpackToVite } from "@omnimod/plugin-webpack-to-vite";
import { cac } from "cac";
import pc from "picocolors";

/** Built-in plugins bundled with the CLI. */
const BUILTINS: Plugin[] = [
  styledToVanillaExtract as Plugin,
  momentToDayjs as Plugin,
  jestToVitest as Plugin,
  lodashToEsToolkit as Plugin,
  reduxToToolkit as Plugin,
  reactClassToHooks as Plugin,
  webpackToVite as Plugin,
];

/** Built-in plugin registry, keyed by plugin name. */
const REGISTRY = new Map<string, Plugin>(BUILTINS.map((plugin) => [plugin.name, plugin]));

/** Sorted names of every built-in plugin. */
export function listPlugins(): string[] {
  return [...REGISTRY.keys()].sort();
}

/** `name — description` lines for every built-in plugin, sorted by name. */
export function describePlugins(): string[] {
  return listPlugins().map((name) => `${name} — ${REGISTRY.get(name)?.description ?? ""}`);
}

async function importPlugin(specifier: string): Promise<Plugin> {
  const mod = (await import(specifier)) as { default?: Plugin; plugin?: Plugin };
  const plugin = mod.default ?? mod.plugin;
  if (!plugin) {
    throw new Error(`Module "${specifier}" has no plugin export (default or \`plugin\`)`);
  }
  return plugin;
}

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ERR_MODULE_NOT_FOUND"
  );
}

/**
 * Resolve a plugin by registered name, a relative/absolute path, or a bare name
 * using the `@omnimod/plugin-<name>` / `omnimod-plugin-<name>` conventions.
 */
export async function resolvePlugin(nameOrPath: string): Promise<Plugin> {
  const known = REGISTRY.get(nameOrPath);
  if (known) return known;

  if (nameOrPath.startsWith(".") || nameOrPath.startsWith("/")) {
    return importPlugin(pathToFileURL(resolve(nameOrPath)).href);
  }

  const candidates = /[@/]/.test(nameOrPath)
    ? [nameOrPath]
    : [`@omnimod/plugin-${nameOrPath}`, `omnimod-plugin-${nameOrPath}`, nameOrPath];

  for (const specifier of candidates) {
    try {
      return await importPlugin(specifier);
    } catch (error) {
      if (!isModuleNotFound(error)) throw error;
    }
  }
  throw new Error(`Could not resolve plugin "${nameOrPath}". Tried: ${candidates.join(", ")}.`);
}

/** Render a run result (diffs, emitted files, diagnostics, summary) for the terminal. */
export function formatResult(result: RunResult, write: boolean, root: string): string {
  const blocks: string[] = [];
  for (const change of result.changed) blocks.push(renderDiff(change));
  for (const file of result.emitted) blocks.push(renderEmitted(file));

  for (const diagnostic of result.diagnostics) {
    const tag =
      diagnostic.severity === "error"
        ? pc.red("error")
        : diagnostic.severity === "warn"
          ? pc.yellow("warn")
          : pc.blue("info");
    blocks.push(`${tag} ${diagnostic.file}: ${diagnostic.message}`);
  }

  // Formatting note: what ran (write), or what would run (dry-run).
  if (result.format && result.format.tools.length > 0) {
    blocks.push(pc.blue(`formatted with ${result.format.tools.join(", ")}`));
    for (const error of result.format.errors) blocks.push(pc.yellow(`format: ${error}`));
  } else if (!write) {
    const fixers = detectFixers(root).map((fixer) => fixer.tool);
    if (fixers.length > 0) {
      blocks.push(pc.dim(`on --write, output will be formatted with ${fixers.join(", ")}`));
    }
  }

  const summary = `${result.changed.length} changed, ${result.emitted.length} created, ${result.diagnostics.length} diagnostic(s)`;
  blocks.push(write ? pc.green(summary) : pc.dim(`${summary} — dry-run, pass --write to apply`));
  return blocks.join("\n\n");
}

interface RunFlags {
  write?: boolean;
  cwd: string;
  exclude?: string | string[];
  format?: boolean;
}

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const cli = cac("omnimod");

  cli
    .command("run <plugin> [...paths]", "Run a codemod plugin over the project")
    .option("--write", "Write changes to disk (default: dry-run)")
    .option("--cwd <dir>", "Project root to operate on", { default: "." })
    .option("--exclude <glob>", "Glob to exclude (repeatable)")
    .option("--no-format", "Skip the project formatter/linter after writing")
    .action(async (plugin: string, paths: string[], flags: RunFlags) => {
      const codemod = await resolvePlugin(plugin);
      const result = await run(codemod, {
        root: flags.cwd,
        include: paths.length > 0 ? paths : undefined,
        exclude: toArray(flags.exclude),
        write: flags.write,
        format: flags.format,
      });
      process.stdout.write(`${formatResult(result, flags.write ?? false, flags.cwd)}\n`);
    });

  cli.command("list", "List available plugins").action(() => {
    process.stdout.write(`${describePlugins().join("\n")}\n`);
  });

  cli.help();
  cli.version("0.1.0");
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
  return 0;
}

async function isDirectInvocation(invoked: string | undefined): Promise<boolean> {
  if (!invoked) return false;

  try {
    return (await realpath(invoked)) === (await realpath(fileURLToPath(import.meta.url)));
  } catch {
    return import.meta.url === pathToFileURL(invoked).href;
  }
}

if (await isDirectInvocation(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exit(1);
    },
  );
}
