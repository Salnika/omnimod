import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { run } from "@omnimod/core";
import { expect, test } from "vite-plus/test";
import { webpackToVite } from "../src/index.ts";

const INPUT = `const path = require("path");
module.exports = { entry: "./src/index.js", resolve: { alias: { "@": "./src" }, extensions: [".js", ".ts"] }, devServer: { port: 3000 } };
`;

async function runPlugin(input: string): Promise<{
  changed: Record<string, string>;
  emitted: Record<string, string>;
  info: string[];
}> {
  const dir = await mkdtemp(join(tmpdir(), "omnimod-wtv-"));
  try {
    await writeFile(join(dir, "webpack.config.js"), input, "utf8");
    const result = await run(webpackToVite, { root: dir });
    const changed: Record<string, string> = {};
    for (const change of result.changed) changed[basename(change.path)] = change.after;
    const emitted: Record<string, string> = {};
    for (const file of result.emitted) emitted[basename(file.path)] = file.contents;
    const info = result.diagnostics.map((diagnostic) => diagnostic.message);
    return { changed, emitted, info };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("emits a vite.config.js skeleton and a migration guide from a static webpack config", async () => {
  const { changed, emitted } = await runPlugin(INPUT);

  const vite = emitted["vite.config.js"] ?? "";
  expect(vite).toContain("defineConfig");
  expect(vite).toContain('import { defineConfig } from "vite";');
  // resolve.alias mapped.
  expect(vite).toContain('"@": "./src"');
  // resolve.extensions mapped.
  expect(vite).toContain("extensions:");
  expect(vite).toContain('".js"');
  expect(vite).toContain('".ts"');
  // devServer.port → server.port.
  expect(vite).toContain("server:");
  expect(vite).toContain("port: 3000");
  // entry → commented TODO (Vite uses index.html).
  expect(vite).toContain("TODO(omnimod)");

  // The migration guide was emitted.
  expect(emitted["WEBPACK_MIGRATION.md"]).toBeTruthy();
  expect(emitted["WEBPACK_MIGRATION.md"]).toContain("Webpack → Vite");

  // The original webpack config is left untouched.
  expect(changed["webpack.config.js"]).toBeUndefined();
});

const LOADER_INPUT = `module.exports = {
  resolve: { alias: { "@src": require("path").resolve(__dirname, "src") } },
  plugins: [new webpack.DefinePlugin({ "process.env.API": JSON.stringify("x") })],
  module: {
    rules: [
      { test: /\\.scss$/, use: ["style-loader", "css-loader", "sass-loader"] },
      { test: /\\.tsx?$/, loader: "ts-loader" },
    ],
  },
};
`;

test("maps DefinePlugin to define, keeps helper aliases with a TODO, and lists loaders", async () => {
  const { emitted, info } = await runPlugin(LOADER_INPUT);

  const vite = emitted["vite.config.js"] ?? "";
  // DefinePlugin → define.
  expect(vite).toContain("define:");
  expect(vite).toContain('"process.env.API"');
  // Helper-valued alias kept verbatim with a TODO.
  expect(vite).toContain('"@src"');
  expect(vite).toContain("TODO(omnimod)");

  // Loader table in the guide.
  const guide = emitted["WEBPACK_MIGRATION.md"] ?? "";
  expect(guide).toContain("sass-loader");
  expect(guide).toContain("ts-loader");
  expect(guide).toContain("Loaders → Vite");

  // A warning was reported about the webpack-only alias helper.
  expect(info.some((message) => message.includes("path.resolve"))).toBe(true);
});
