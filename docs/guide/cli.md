# CLI

The `omnimod` binary (from `@omnimod/cli`) runs a plugin over a project.

## `omnimod run <plugin> [paths...]`

Run a codemod. `paths` are include globs (relative to `--cwd`); if omitted, the
plugin's own `include` is used.

```bash
omnimod run styled-to-vanilla-extract "src/**/*.tsx" --write
```

### Options

| Flag               | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `--write`          | Write changes to disk. Without it, the command is a **dry-run** (prints a diff). |
| `--cwd <dir>`      | Project root to operate on (default `.`).                                        |
| `--exclude <glob>` | Glob to exclude. Repeatable.                                                     |
| `--no-format`      | Skip running the project's formatter after writing.                              |

### Plugin resolution

The `<plugin>` argument is resolved in this order:

1. A **built-in** plugin name (e.g. `styled-to-vanilla-extract`).
2. A **relative/absolute path** to a module (`./my-plugin.ts`).
3. A **bare name** via conventions: `@omnimod/plugin-<name>`, then
   `omnimod-plugin-<name>`, then the raw specifier.

So a third-party plugin published as `@omnimod/plugin-foo` runs as
`omnimod run foo`.

### Formatting

On `--write`, the written files are formatted with the **project's own**
formatter/linter — auto-detected in this order: Biome, then ESLint `--fix`
followed by Prettier, else dprint. This makes the output match the project's
conventions (quotes, semicolons, indentation, import order) without omnimod
reading any config. Use `--no-format` to skip.

## `omnimod list`

List the built-in plugins.

```bash
omnimod list
# styled-to-vanilla-extract
```
