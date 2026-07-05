# Introduction

**omnimod** is a modular, plugin-based codemod tool for TypeScript / JavaScript /
React codebases. A small **core** provides the codemod machinery; **plugins**
encapsulate specific transformations.

## Why omnimod

- **Formatting-preserving.** The core parses with [`oxc-parser`](https://oxc.rs)
  (ESTree AST, UTF-16 offsets) and applies edits as
  [`magic-string`](https://github.com/Rich-Harris/magic-string) splices, so
  untouched code stays byte-identical. Generated files are then run through the
  target project's own formatter, so output matches its conventions.
- **Modular.** The engine knows nothing about any specific transformation. A
  plugin is one object with a `transform` function (plus optional `analyze` and
  `finalize` for cross-file work).
- **Batteries included.** Seven plugins ship today — styling
  ([`styled-to-vanilla-extract`](/plugins/styled-to-vanilla-extract)), dates
  ([`moment-to-dayjs`](/plugins/moment-to-dayjs)), testing
  ([`jest-to-vitest`](/plugins/jest-to-vitest)), utilities
  ([`lodash-to-es-toolkit`](/plugins/lodash-to-es-toolkit)), state
  ([`redux-to-toolkit`](/plugins/redux-to-toolkit)), React
  ([`react-class-to-hooks`](/plugins/react-class-to-hooks)) and build tooling
  ([`webpack-to-vite`](/plugins/webpack-to-vite)).

## Packages

| Package                 | Responsibility                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `@omnimod/core`         | Parse, `walk`, the `Plugin` contract, `run()` orchestration, diffs, formatting.                    |
| `@omnimod/plugin-utils` | Helpers for plugin authors (shared ESTree node types + `cast`, CSS-in-JS parsing, a vanilla-extract object model, import management). |
| `@omnimod/cli`          | The `omnimod` command.                                                                             |
| `@omnimod/plugin-*`     | Plugins.                                                                                           |

## How it works

`run(plugin, options)` does the orchestration:

1. **Discover** — glob the project (respecting `.gitignore`) for files matching
   the plugin's `include`.
2. **Parse** each file once into an AST + a `magic-string` edit buffer.
3. **`analyze`** — an optional first pass over every file that collects cross-file
   facts into a shared `ProjectContext.state`.
4. **`transform`** — the main pass: each file is rewritten via its edit buffer,
   and new files can be emitted.
5. **`finalize`** — an optional last pass that emits shared files (e.g. a theme
   contract, or a migration report).
6. **Write / dry-run** — with `write: true`, changed and emitted files are
   written and formatted; otherwise a colored diff is returned.

Next: [Getting started](/guide/getting-started).
