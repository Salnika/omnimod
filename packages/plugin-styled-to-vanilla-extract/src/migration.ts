import { relative } from "node:path";
import type { MigrationNote } from "./state.ts";

interface Category {
  id: string;
  title: string;
  match: (message: string) => boolean;
  guidance: string[];
}

const CATEGORIES: Category[] = [
  {
    id: "attrs-as",
    title: "`styled(...).attrs()` and the `as` prop",
    match: (message) => /\.attrs|`as`/.test(message),
    guidance: [
      "These components were left as styled-components (not converted).",
      "For `styled.tag.attrs({ ...defaults })`: convert the CSS to a `style()`/`recipe()` in a sibling `.css.ts` (mirror the already-converted files), then move each default attribute onto every JSX usage (e.g. `.attrs({ type: 'button' })` → add `type=\"button\"` to each element) and rewrite `<Comp>` to the intrinsic tag with `className={...}`.",
      "For `styled(Base).attrs(...)`: same, and compose the base style via `clsx(base, ...)`.",
      'For the polymorphic `as` prop (`<Comp as="a">`): render the target element directly and keep the `className`.',
    ],
  },
  {
    id: "unconverted",
    title: "Interpolations left as `// TODO(omnimod)`",
    match: (message) =>
      /could not convert|unsupported interpolation|left a TODO|Reference to|Conditional block|Unknown word|needs a theme contract/.test(
        message,
      ),
    guidance: [
      "Open the generated `.css.ts` for each file below and search for `TODO(omnimod)` — each marks a dynamic value the codemod could not translate (function calls like `theme.spacing(2)`, logical fallbacks like `p.x || y`, or an unrecognised block).",
      "Using the original styled-components source (git diff / history), replace each TODO:",
      "- value driven by a discrete prop → a `recipe` variant;",
      "- value driven by a continuous prop → `createVar()` + `assignInlineVars` at the usage site;",
      "- a theme token → the matching `vars.*` reference;",
      "- a static computed value → inline the computed result.",
    ],
  },
  {
    id: "variant-in-selector",
    title: "Prop-conditional inside a pseudo / nested selector",
    match: (message) => /nested selector was inlined/.test(message),
    guidance: [
      "A prop-conditional inside a selector (e.g. `&:hover { color: ${p => (p.x ? a : b)} }`) was flattened to a single value, so the per-prop hover/focus state is lost.",
      "Restore it as a recipe variant that carries the nested selector, e.g. `variants: { x: { danger: { ':hover': { color: '...' } } } }`, and keep the base rule for the default.",
    ],
  },
  {
    id: "descendant-in-recipe",
    title: "Descendant selector in a variant recipe",
    match: (message) => /Descendant selector skipped/.test(message),
    guidance: [
      "A descendant selector (`& .child`) was dropped because the component became a `recipe()` whose class is computed per-variant.",
      "Reintroduce it with `globalStyle` keyed on a stable wrapper class, or extract a dedicated `style()` for the child and apply it directly on the child element.",
    ],
  },
];

const OTHER: Category = {
  id: "other",
  title: "Other notes",
  match: () => true,
  guidance: ["Review each item against the original component and adjust the generated `.css.ts`."],
};

function categoryOf(message: string): Category {
  return CATEGORIES.find((category) => category.match(message)) ?? OTHER;
}

function themeSetupSection(themePaths: string[]): string[] {
  if (themePaths.length === 0) return [];
  const tokens = themePaths.map((path) => `  - \`${path}\``).join("\n");
  return [
    "### Theme values",
    "",
    "`omnimod-theme.css.ts` is a `createThemeContract` with `null` leaves (structure only). Assign the real values from the old theme:",
    "",
    "```ts",
    'import { createTheme } from "@vanilla-extract/css";',
    'import { vars } from "./omnimod-theme.css";',
    "",
    "export const themeClass = createTheme(vars, {",
    "  /* same shape as vars, with real values */",
    "});",
    "```",
    "",
    "Apply `themeClass` on a wrapping element. Tokens the code reads:",
    "",
    tokens,
    "",
  ];
}

/** Render a MIGRATION.md that an AI agent can follow to finish the migration. */
export function renderMigrationGuide(
  notes: MigrationNote[],
  root: string,
  themePaths: string[],
): string {
  // Dedupe (file + message) and group by category.
  const seen = new Set<string>();
  const byCategory = new Map<
    string,
    { category: Category; items: { file: string; message: string }[] }
  >();
  for (const note of notes) {
    const relFile = relative(root, note.file).split("\\").join("/");
    const key = `${relFile}::${note.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const category = categoryOf(note.message);
    let group = byCategory.get(category.id);
    if (!group) {
      group = { category, items: [] };
      byCategory.set(category.id, group);
    }
    group.items.push({ file: relFile, message: note.message });
  }

  const lines: string[] = [
    "# Finish the styled-components → vanilla-extract migration",
    "",
    "_Generated by omnimod._ The codemod converted most components automatically",
    "(see the new `*.css.ts` files and the rewritten components). This file lists",
    "everything it could **not** finish. You are an AI agent: complete every task",
    "below, then run the checks at the end. Work file by file; the original code is",
    "in the git diff for reference.",
    "",
    "## 0. One-time setup",
    "",
    "- Install runtime deps: `@vanilla-extract/css`, `@vanilla-extract/recipes`, `@vanilla-extract/dynamic`, `clsx`.",
    "- Wire the bundler: add `@vanilla-extract/vite-plugin` (or the webpack/Next equivalent) so `.css.ts` files are processed.",
    '- Remove any leftover `import ... from "styled-components"` once a file has no remaining styled usages (the codemod keeps it whenever something was skipped).',
    "- Formatting was applied automatically with your project's formatter; re-run it after any manual edits below.",
    "",
    ...themeSetupSection(themePaths),
  ];

  // Ordered sections: known categories first, then OTHER.
  const order = [...CATEGORIES.map((category) => category.id), OTHER.id];
  let index = 1;
  for (const id of order) {
    const group = byCategory.get(id);
    if (!group || group.items.length === 0) continue;
    lines.push(`## ${index}. ${group.category.title} (${group.items.length})`, "");
    for (const guidance of group.category.guidance) lines.push(guidance, "");
    lines.push("Affected:");
    for (const item of group.items) lines.push(`- \`${item.file}\` — ${item.message}`);
    lines.push("");
    index += 1;
  }

  lines.push(
    "## Verify",
    "",
    "- Type-check the project (no errors in the generated `.css.ts` / rewritten components).",
    "- Build with the vanilla-extract bundler plugin enabled.",
    "- Compare the UI before/after for the components touched above.",
    "",
  );

  return lines.join("\n");
}
