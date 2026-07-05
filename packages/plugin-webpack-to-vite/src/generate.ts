import type { WebpackConfig } from "./extract.ts";

/** JSON-quote a string for use as an object key/value. */
function quote(value: string): string {
  return JSON.stringify(value);
}

/** Render the mapped `vite.config.js` skeleton from a parsed webpack config. */
export function renderViteConfig(config: WebpackConfig): string {
  const body: string[] = [];

  // resolve: { alias, extensions }
  const resolveLines: string[] = [];
  if (config.aliases.length > 0) {
    const aliasLines = config.aliases.map((alias) => {
      // Static string values are safe to reproduce verbatim; anything else
      // (path.resolve(...) etc.) is kept as-is with a TODO for manual review.
      if (alias.literal !== null) {
        return `      ${quote(alias.key)}: ${quote(alias.literal)},`;
      }
      return `      ${quote(alias.key)}: ${alias.valueSource}, // TODO(omnimod): review webpack-only helper; Vite resolves relative to the config file`;
    });
    resolveLines.push("    alias: {", ...aliasLines, "    },");
  }
  if (config.extensions && config.extensions.length > 0) {
    const exts = config.extensions.map((ext) => quote(ext)).join(", ");
    resolveLines.push(`    extensions: [${exts}],`);
  }
  if (resolveLines.length > 0) {
    body.push("  resolve: {", ...resolveLines, "  },");
  }

  // define: {...}
  if (config.define.length > 0) {
    const defineLines = config.define.map(
      (entry) => `    ${quote(entry.key)}: ${entry.valueSource},`,
    );
    body.push("  define: {", ...defineLines, "  },");
  }

  // server: { port, proxy }
  const serverLines: string[] = [];
  if (config.devServerPort !== null) serverLines.push(`    port: ${config.devServerPort},`);
  if (config.devServerProxy !== null) {
    serverLines.push(
      `    proxy: ${config.devServerProxy}, // TODO(omnimod): Vite proxy uses the same http-proxy options; verify keys`,
    );
  }
  if (serverLines.length > 0) {
    body.push("  server: {", ...serverLines, "  },");
  }

  // entry / output → commented notes (Vite uses index.html as the entry).
  const notes: string[] = [];
  if (config.entry !== null) {
    notes.push(
      `  // TODO(omnimod): webpack entry was ${inlineComment(config.entry)}. Vite uses index.html as the entry point; move your entry <script> there.`,
    );
  }
  if (config.output !== null) {
    notes.push(
      `  // TODO(omnimod): webpack output was ${inlineComment(config.output)}. Configure Vite output via build.outDir / build.rollupOptions if needed.`,
    );
  }
  if (config.rules.length > 0) {
    notes.push(
      "  // TODO(omnimod): module.rules (loaders) were not translated. See WEBPACK_MIGRATION.md for the Vite equivalents.",
    );
  }
  notes.push(
    "  // TODO(omnimod): add your framework plugin, e.g. `plugins: [react()]` from @vitejs/plugin-react.",
  );

  const inner = [...body, ...notes].join("\n");
  return `import { defineConfig } from "vite";\n\nexport default defineConfig({\n${inner}\n});\n`;
}

/** Collapse a source snippet into a single-line, comment-safe fragment. */
function inlineComment(source: string): string {
  return source.replace(/\s+/g, " ").replace(/\*\//g, "* /").trim();
}
