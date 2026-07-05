# @omnimod/cli

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fcli?label=npm)](https://www.npmjs.com/package/@omnimod/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

Command-line runner for omnimod codemods.

The CLI bundles the official migration plugins and can also resolve external
plugins by package name or local path.

## Install

```bash
pnpm add -D @omnimod/cli
```

## Usage

```bash
omnimod list
omnimod run styled-to-vanilla-extract "src/**/*.tsx"
omnimod run styled-to-vanilla-extract "src/**/*.tsx" --write
```

Runs are dry by default. Pass `--write` to update files and `--no-format` to
skip formatter/linter detection after writing.

## Commands

- `omnimod list`: list bundled plugins.
- `omnimod run <plugin> [...paths]`: run one plugin against a project.

## Bundled Plugins

- `styled-to-vanilla-extract`
- `moment-to-dayjs`
- `jest-to-vitest`
- `lodash-to-es-toolkit`
- `redux-to-toolkit`
- `react-class-to-hooks`
- `webpack-to-vite`
