# @omnimod/plugin-jest-to-vitest

[![npm](https://img.shields.io/npm/v/%40omnimod%2Fplugin-jest-to-vitest?label=npm)](https://www.npmjs.com/package/@omnimod/plugin-jest-to-vitest)
[![CI](https://img.shields.io/github/actions/workflow/status/Salnika/omnimod/ci.yml?branch=master&label=ci)](https://github.com/Salnika/omnimod/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Salnika/omnimod)](../../LICENSE)

omnimod plugin that migrates common Jest APIs and imports to Vitest.

## Use With The CLI

```bash
omnimod run jest-to-vitest "src/**/*.{ts,tsx,js,jsx}"
omnimod run jest-to-vitest "src/**/*.{ts,tsx,js,jsx}" --write
```

## Use As A Library

```ts
import { jestToVitest } from "@omnimod/plugin-jest-to-vitest";
```

## Notes

The plugin handles common `jest.*` to `vi.*` migrations and `@jest/globals`
imports. Complex module mocking patterns are reported as diagnostics for manual
review.
