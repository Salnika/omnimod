# @omnimod/plugin-webpack-to-vite

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-webpack-to-vite?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-webpack-to-vite)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that scaffolds a Vite config from a Webpack config.

## Use With The CLI

```bash
omnimod run webpack-to-vite "webpack.config.{js,ts,cjs,mjs}"
omnimod run webpack-to-vite "webpack.config.{js,ts,cjs,mjs}" --write
```

## Use As A Library

```ts
import { webpackToVite } from "@omnimod/plugin-webpack-to-vite";
```

## Notes

The plugin extracts supported Webpack configuration fields and emits a Vite
configuration scaffold. Project-specific loader, plugin, and runtime behavior is
reported for manual migration.
