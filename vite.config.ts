import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // The docs are a standalone VitePress (npm) project — keep them out of `vp`.
  fmt: {
    ignorePatterns: ["docs/**"],
  },
  lint: {
    ignorePatterns: ["docs/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
