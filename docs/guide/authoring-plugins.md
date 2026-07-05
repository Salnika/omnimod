# Authoring a plugin

A plugin is a single object that satisfies the `Plugin` contract from
`@omnimod/core`. Use `definePlugin` for type inference.

```ts
import { definePlugin, walk } from "@omnimod/core";

export default definePlugin({
  name: "rename-foo-to-bar",
  include: ["**/*.{ts,tsx}"],
  transform(file) {
    walk(file.program, (node) => {
      if (node.type === "Identifier" && node.name === "foo") {
        file.magic.update(node.start, node.end, "bar");
      }
    });
  },
});
```

That's a complete, runnable plugin. Run it with
`omnimod run ./rename-foo-to-bar.ts "src/**/*.ts" --write`.

## The `Plugin` contract

```ts
interface Plugin<Options = Record<string, unknown>, State = unknown> {
  name: string;
  description?: string;
  include?: string[]; // globs, relative to the run root
  exclude?: string[];
  createState?(): State; // initial shared store (default {})
  analyze?(file, project, options): void | Promise<void>;
  transform(file, project, options): void | Promise<void>;
  finalize?(project, options): EmittedFile[] | void;
}
```

### Lifecycle

`run()` drives a two-phase map/reduce so plugins can do cross-file work:

1. **`analyze`** runs over **every** file first. Use it to collect facts into
   `project.state` (e.g. "which components are exported where").
2. **`transform`** then runs over every file, rewriting each using that state.
3. **`finalize`** runs once at the end and may return files to emit (e.g. a
   generated theme, a report).

Only `transform` is required. Skip `analyze`/`createState` for single-file
transforms.

## `FileContext`

Everything you need to inspect and rewrite one file:

```ts
interface FileContext {
  path: string; // absolute path
  source: string; // original, unmodified text
  program: Program; // parsed oxc ESTree AST
  comments: Node[];
  magic: MagicString; // the edit buffer — mutate this
  report(d: { message: string; severity: "info" | "warn" | "error"; line?: number }): void;
  emit(file: { path: string; contents: string }): void;
}
```

- **Edit** by mutating `file.magic` (`update`, `appendLeft`, `remove`, `prepend`,
  …). oxc offsets are UTF-16, so they feed straight into `magic-string`.
- **`emit`** a new file (relative paths resolve against the run root).
- **`report`** a diagnostic for the CLI and for follow-up tooling.

Return without touching `file.magic` to leave a file unchanged.

## `ProjectContext`

Shared, cross-file context passed to `analyze`/`transform`/`finalize`:

```ts
interface ProjectContext<State> {
  root: string; // absolute project root
  state: State; // your reduce target
  resolve(fromFile: string, specifier: string): string | null; // relative import → abs path
}
```

## Traversal

`walk(node, enter, leave?)` is an engine-agnostic depth-first visitor. Return
`"skip"` from `enter` to avoid descending into a node's children.

```ts
walk(file.program, (node, parent, key, index) => {
  if (node.type === "ImportDeclaration") return "skip";
});
```

## Helpers for CSS-in-JS plugins

`@omnimod/plugin-utils` provides building blocks used by the styled-components
plugin — reuse them for similar migrations:

- **CSS parsing**: `buildPlaceholderCss`, `parseScss`, `cssToVeStyle`,
  `keyframesToVe`, `globalRules` (postcss + interpolation placeholders).
- **A vanilla-extract object model**: `veObject`/`veString`/`veRaw`/… and
  `serializeVe` to render it as formatted TS source.
- **`ImportManager`** to collect and render deduped `import` statements.
- **`cssPropToCamel`** for CSS property → camelCase.

## Distribution & discovery

Name your package `@omnimod/plugin-<name>` or `omnimod-plugin-<name>` and export
the plugin as the **default** export (or a named `plugin` export). Then it runs
by short name:

```bash
omnimod run <name> "src/**/*.tsx" --write
```

## Testing

Plugins are easiest to test as input → output fixtures. Write files to a temp
directory, run the plugin, and assert on the result:

```ts
import { run } from "@omnimod/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import myPlugin from "../src/index.ts";

const dir = await mkdtemp(join(tmpdir(), "t-"));
await writeFile(join(dir, "a.ts"), "const foo = 1;\n");
const result = await run(myPlugin, { root: dir });
expect(result.changed[0].after).toBe("const bar = 1;\n");
```
