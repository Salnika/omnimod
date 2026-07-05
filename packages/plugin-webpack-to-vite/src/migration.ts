import type { RuleInfo, WebpackConfig } from "./extract.ts";

/** Known webpack loader → Vite equivalent, keyed by a substring of the loader name. */
const LOADER_MAP: { match: string; label: string; vite: string }[] = [
  {
    match: "babel-loader",
    label: "babel-loader",
    vite: "Built in via esbuild. Remove; no config needed for standard JS/JSX/TS.",
  },
  {
    match: "ts-loader",
    label: "ts-loader",
    vite: "Built in via esbuild. Remove; Vite transpiles TypeScript out of the box (type-check separately with `tsc --noEmit`).",
  },
  {
    match: "style-loader",
    label: "style-loader",
    vite: "Built in. Remove; Vite injects CSS automatically.",
  },
  {
    match: "css-loader",
    label: "css-loader",
    vite: 'Built in. Remove; `import "./x.css"` just works. Use `*.module.css` for CSS Modules.',
  },
  {
    match: "sass-loader",
    label: "sass-loader",
    vite: "Install `sass` as a dev dependency; Vite compiles `.scss`/`.sass` automatically.",
  },
  {
    match: "postcss-loader",
    label: "postcss-loader",
    vite: "Add a `postcss.config.js`; Vite runs PostCSS automatically.",
  },
  {
    match: "less-loader",
    label: "less-loader",
    vite: "Install `less`; Vite compiles `.less` automatically.",
  },
  {
    match: "file-loader",
    label: "file-loader",
    vite: 'Use asset imports: `import url from "./x.png?url"`, or put static files under `public/`.',
  },
  {
    match: "url-loader",
    label: "url-loader",
    vite: "Use `?url` / `?inline` import suffixes; small assets are inlined automatically.",
  },
  {
    match: "raw-loader",
    label: "raw-loader",
    vite: 'Use the `?raw` import suffix: `import src from "./x.txt?raw"`.',
  },
  {
    match: "svg",
    label: "svg loader",
    vite: "Use `?url`/`?raw`, or add `vite-plugin-svgr` for React components.",
  },
];

/** Best-effort mapping of a single loader name to its Vite guidance. */
function mapLoader(loader: string): { label: string; vite: string } {
  for (const entry of LOADER_MAP) {
    if (loader.includes(entry.match)) return { label: entry.label, vite: entry.vite };
  }
  return {
    label: loader,
    vite: "No direct Vite equivalent detected. Check if a Vite plugin exists, or handle in a custom plugin.",
  };
}

/** Render the loader-mapping rows for the config's `module.rules`. */
function renderLoaderTable(rules: RuleInfo[]): string {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const rule of rules) {
    for (const loader of rule.loaders) {
      const { label, vite } = mapLoader(loader);
      const test = rule.test ? ` (\`${rule.test}\`)` : "";
      const key = `${label}${test}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(`| \`${label}\`${test} | ${vite} |`);
    }
  }
  if (rows.length === 0) {
    rows.push("| _(no loaders detected)_ | — |");
  }
  return ["| Webpack loader | Vite equivalent |", "| --- | --- |", ...rows].join("\n");
}

/** Render the full agent-ready `WEBPACK_MIGRATION.md`. */
export function renderMigrationGuide(config: WebpackConfig, viteConfigName: string): string {
  const lines: string[] = [];
  lines.push("# Finish the Webpack → Vite migration");
  lines.push("");
  lines.push(
    `omnimod scaffolded a \`${viteConfigName}\` next to your \`webpack.config\`. The original webpack config was **left untouched**. Follow the steps below to complete the migration, then delete the webpack config and its loaders/plugins.`,
  );
  lines.push("");

  lines.push("## One-time setup");
  lines.push("");
  lines.push("1. Install Vite and your framework plugin as dev dependencies:");
  lines.push("");
  lines.push("   ```sh");
  lines.push("   npm install -D vite");
  lines.push("   # then the plugin for your framework, e.g.:");
  lines.push("   #   React:  npm install -D @vitejs/plugin-react");
  lines.push("   #   Vue:    npm install -D @vitejs/plugin-vue");
  lines.push("   #   Svelte: npm install -D @sveltejs/vite-plugin-svelte");
  lines.push("   ```");
  lines.push("");
  lines.push(
    `2. Register the plugin in \`${viteConfigName}\` (uncomment/adjust the \`plugins\` TODO).`,
  );
  lines.push("");

  lines.push("## Entry point");
  lines.push("");
  lines.push(
    "Vite is served from an `index.html` at the project root (not a JS `entry`). Create `index.html` and reference your entry module directly:",
  );
  lines.push("");
  lines.push("```html");
  lines.push("<!doctype html>");
  lines.push("<html>");
  lines.push("  <head>");
  lines.push('    <meta charset="utf-8" />');
  lines.push("    <title>App</title>");
  lines.push("  </head>");
  lines.push("  <body>");
  lines.push('    <div id="root"></div>');
  lines.push('    <script type="module" src="/src/index.js"></script>');
  lines.push("  </body>");
  lines.push("</html>");
  lines.push("```");
  if (config.entry) {
    lines.push("");
    lines.push(`> Detected webpack \`entry\`: \`${config.entry.replace(/\s+/g, " ")}\``);
  }
  lines.push("");

  lines.push("## Environment variables");
  lines.push("");
  lines.push(
    "Vite only exposes env vars prefixed with `VITE_`, accessed via `import.meta.env.VITE_*` (not `process.env.*`).",
  );
  lines.push("");
  lines.push("- Rename `MY_VAR` → `VITE_MY_VAR` in your `.env` files.");
  lines.push("- Replace `process.env.MY_VAR` → `import.meta.env.VITE_MY_VAR` in source.");
  if (config.define.length > 0) {
    lines.push(
      `- The following \`DefinePlugin\` keys were mapped into \`define\` in the generated config: ${config.define
        .map((entry) => `\`${entry.key}\``)
        .join(", ")}.`,
    );
  }
  lines.push("");

  lines.push("## Loaders → Vite");
  lines.push("");
  lines.push(renderLoaderTable(config.rules));
  lines.push("");

  lines.push("## npm scripts");
  lines.push("");
  lines.push("Replace your webpack scripts with Vite's:");
  lines.push("");
  lines.push("```jsonc");
  lines.push("{");
  lines.push('  "scripts": {');
  lines.push('    "dev": "vite",           // was: "webpack serve"');
  lines.push('    "build": "vite build",   // was: "webpack" / "webpack --mode production"');
  lines.push('    "preview": "vite preview"');
  lines.push("  }");
  lines.push("}");
  lines.push("```");
  lines.push("");

  lines.push("## Verify");
  lines.push("");
  lines.push("- [ ] `npm run dev` boots and the app loads.");
  lines.push("- [ ] `npm run build` produces a working `dist/`.");
  lines.push("- [ ] All aliases and env vars resolve.");
  lines.push("- [ ] The old `webpack.config` and webpack deps are removed.");
  lines.push("");

  return `${lines.join("\n")}`;
}
