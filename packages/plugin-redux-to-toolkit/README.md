# @omnimod/plugin-redux-to-toolkit

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-redux-to-toolkit?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-redux-to-toolkit)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that migrates legacy Redux store setup to Redux Toolkit.

## Use With The CLI

```bash
omnimod run redux-to-toolkit "src/**/*.{ts,tsx,js,jsx}"
omnimod run redux-to-toolkit "src/**/*.{ts,tsx,js,jsx}" --write
```

## Use As A Library

```ts
import { reduxToToolkit } from "@omnimod/plugin-redux-to-toolkit";
```

## Notes

The plugin rewrites supported `createStore` usage to `configureStore` and updates
imports. Reducer rewrites, middleware-specific behavior, and connected component
patterns may need manual follow-up.
