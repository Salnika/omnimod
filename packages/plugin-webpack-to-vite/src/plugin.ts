import { definePlugin, type FileContext } from "@omnimod/core";
import { extractConfig } from "./extract.ts";
import { renderViteConfig } from "./generate.ts";
import { renderMigrationGuide } from "./migration.ts";

export type WebpackToViteOptions = Record<string, unknown>;

/** Directory portion of an absolute POSIX/Windows path (no node:path dep needed). */
function dirOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Join a directory and a file name with the directory's separator. */
function join(dir: string, name: string): string {
  if (dir === "") return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir}${sep}${name}`;
}

/**
 * Scaffold a Vite config from a Webpack config. Webpack configs are arbitrary
 * JS, so this never transforms the original file. Instead it reads what it can
 * *statically* (resolve.alias/extensions, DefinePlugin, devServer.port/proxy,
 * entry/output, module.rules) and emits a sibling `vite.config.js` skeleton plus
 * a `WEBPACK_MIGRATION.md` agent guide, then reports where to look next.
 */
export const webpackToVite = definePlugin<WebpackToViteOptions>({
  name: "webpack-to-vite",
  description: "Scaffold a Vite config from a Webpack config.",
  include: ["**/webpack.config.{js,ts,cjs,mjs}"],

  transform(file: FileContext): void {
    const config = extractConfig(file.program, file.source);

    const dir = dirOf(file.path);
    const viteConfigName = "vite.config.js";
    const viteConfigPath = join(dir, viteConfigName);
    const migrationPath = join(dir, "WEBPACK_MIGRATION.md");

    if (!config.found) {
      // A function/array-returning config (or no recognizable export). Still
      // emit a starter skeleton + guide, but flag that nothing was read.
      file.report({
        severity: "warn",
        message:
          "Could not statically read a `module.exports = {…}` / `export default {…}` object " +
          "(function- or array-returning config?). Emitted a starter vite.config.js and " +
          "WEBPACK_MIGRATION.md; you'll need to port the fields by hand.",
      });
    }

    if (config.aliasesHaveHelpers) {
      file.report({
        severity: "warn",
        message:
          "Some `resolve.alias` values use webpack-only helpers (e.g. path.resolve). They were " +
          "copied verbatim into vite.config.js with a // TODO — Vite resolves relative to the " +
          "config file, so review them.",
      });
    }

    file.emit({ path: viteConfigPath, contents: renderViteConfig(config) });
    file.emit({ path: migrationPath, contents: renderMigrationGuide(config, viteConfigName) });

    file.report({
      severity: "info",
      message: `Emitted ${viteConfigName} and WEBPACK_MIGRATION.md next to this webpack config. The webpack config was left untouched.`,
    });
  },
});
