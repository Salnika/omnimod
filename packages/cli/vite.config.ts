import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    // Manage `bin`/`exports` by hand so the command stays `omnimod`
    // (auto-sync derives the bin name from the package name → "cli").
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
