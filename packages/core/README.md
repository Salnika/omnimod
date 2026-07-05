# @omnimod/core

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fcore?label=npm)](https://www.npmjs.com/package/@omnimod/core)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

Core engine for omnimod, a modular codemod tool built on `oxc-parser` and
`magic-string`.

This package provides the plugin contract, parsing, AST walking, project
orchestration, formatting hooks, and terminal diff rendering used by the CLI and
plugins.

## Install

```bash
pnpm add @omnimod/core
```

## API

```ts
import { definePlugin, run, walk } from "@omnimod/core";
```

Main exports:

- `definePlugin`: create a typed omnimod plugin.
- `run`: execute a plugin across a project.
- `parseFile`: parse JS, JSX, TS, and TSX files.
- `walk`: traverse ESTree-compatible AST nodes.
- `detectFixers` and `formatFiles`: run detected project formatters after writes.
- `renderDiff` and `renderEmitted`: render terminal output for changed and emitted files.

## Plugin Lifecycle

Plugins can implement `analyze`, `transform`, and `finalize` phases. `analyze`
runs across all files first, `transform` applies edits per file, and `finalize`
can emit follow-up files such as migration notes.
