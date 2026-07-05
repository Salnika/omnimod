# @omnimod/plugin-utils

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-utils?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-utils)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

Helpers for authoring omnimod plugins.

This package contains shared AST types, CSS-in-JS parsing helpers,
vanilla-extract serialization helpers, and import editing utilities used by the
official plugins.

## Install

```bash
pnpm add @omnimod/plugin-utils
```

## API

```ts
import { ImportManager, cast, parseScss, serializeVe } from "@omnimod/plugin-utils";
```

Main exports:

- `cast`: typed AST node casting helper.
- `parseScss`, `cssToVeStyle`, `globalRules`, `keyframesToVe`: CSS and SCSS helpers.
- `ImportManager`: utility for editing import declarations.
- `serializeVe` and `ve*` helpers: build and print vanilla-extract object values.
