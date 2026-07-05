import { expect, test } from "vite-plus/test";
import { formatResult, listPlugins, resolvePlugin } from "../src/index.ts";

test("listPlugins includes the styled-to-vanilla-extract plugin", () => {
  expect(listPlugins()).toContain("styled-to-vanilla-extract");
});

test("resolvePlugin returns a registered plugin by name", async () => {
  const plugin = await resolvePlugin("styled-to-vanilla-extract");
  expect(plugin.name).toBe("styled-to-vanilla-extract");
});

test("formatResult summarizes a dry-run", () => {
  const output = formatResult({ changed: [], emitted: [], diagnostics: [] }, false, ".");
  expect(output).toContain("dry-run");
});

test("resolvePlugin throws a helpful error for an unknown name", async () => {
  await expect(resolvePlugin("definitely-not-a-plugin")).rejects.toThrow(
    /Could not resolve plugin/,
  );
});
