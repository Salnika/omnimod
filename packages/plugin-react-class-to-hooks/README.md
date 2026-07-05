# @omnimod/plugin-react-class-to-hooks

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-react-class-to-hooks?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-react-class-to-hooks)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that migrates simple React class components to function
components with hooks.

## Use With The CLI

```bash
omnimod run react-class-to-hooks "src/**/*.{tsx,jsx}"
omnimod run react-class-to-hooks "src/**/*.{tsx,jsx}" --write
```

## Use As A Library

```ts
import { reactClassToHooks } from "@omnimod/plugin-react-class-to-hooks";
```

## Notes

The plugin targets straightforward class components with state, props, and common
lifecycle methods. Complex patterns such as HOCs, refs, and derived state are
reported as diagnostics.
