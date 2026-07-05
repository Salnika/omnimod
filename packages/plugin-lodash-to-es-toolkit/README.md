# @omnimod/plugin-lodash-to-es-toolkit

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-lodash-to-es-toolkit?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-lodash-to-es-toolkit)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that migrates lodash imports to es-toolkit, and to native APIs
where the replacement is safe.

## Use With The CLI

```bash
omnimod run lodash-to-es-toolkit "src/**/*.{ts,tsx,js,jsx}"
omnimod run lodash-to-es-toolkit "src/**/*.{ts,tsx,js,jsx}" --write
```

## Use As A Library

```ts
import { lodashToEsToolkit } from "@omnimod/plugin-lodash-to-es-toolkit";
```

## Notes

The plugin rewrites supported named lodash imports. Helpers with semantics that
need review are left in place and reported as diagnostics.
