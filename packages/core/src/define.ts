import type { Plugin } from "./types.ts";

/**
 * Identity helper for authoring a plugin. It changes nothing at runtime but
 * gives full type inference and a single, discoverable entry point:
 *
 * ```ts
 * import { definePlugin } from "@omnimod/core";
 *
 * export default definePlugin({
 *   name: "my-codemod",
 *   include: ["**\/*.ts"],
 *   transform(file) {
 *     // mutate file.magic / file.emit(...) / file.report(...)
 *   },
 * });
 * ```
 */
export function definePlugin<Options = Record<string, unknown>, State = unknown>(
  plugin: Plugin<Options, State>,
): Plugin<Options, State> {
  return plugin;
}
