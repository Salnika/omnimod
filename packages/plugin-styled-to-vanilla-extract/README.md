# @omnimod/plugin-styled-to-vanilla-extract

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-styled-to-vanilla-extract?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-styled-to-vanilla-extract)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that converts supported `styled-components` patterns to
vanilla-extract.

## Use With The CLI

```bash
omnimod run styled-to-vanilla-extract "src/**/*.{tsx,jsx}"
omnimod run styled-to-vanilla-extract "src/**/*.{tsx,jsx}" --write
```

## Use As A Library

```ts
import { styledToVanillaExtract } from "@omnimod/plugin-styled-to-vanilla-extract";
```

## Notes

The plugin emits sibling `*.css.ts` files and rewrites supported JSX usage.
Ambiguous styling patterns are left in place with diagnostics and migration
notes.
