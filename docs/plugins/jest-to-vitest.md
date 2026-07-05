# jest → vitest

`@omnimod/plugin-jest-to-vitest` migrates [Jest](https://jestjs.io) test files to
[Vitest](https://vitest.dev). The two share most of their surface, so the change
is mostly the `jest` global becoming `vi` plus the import source.

```bash
omnimod run jest-to-vitest "**/*.{test,spec}.{ts,tsx,js,jsx}" --write
```

The target project needs `vitest` installed.

## Example

```ts
// before
const fn = jest.fn();
jest.spyOn(obj, "m");

// after
import { vi } from "vitest";
const fn = vi.fn();
vi.spyOn(obj, "m");
```

## Automated

- `jest.*` → `vi.*` (`fn`, `mock`, `spyOn`, `useFakeTimers`, `clearAllMocks`, …).
- Prepends `import { vi } from "vitest"` when `vi` is used and not yet imported.
- Rewrites `@jest/globals` imports to `vitest`.

## Flagged for follow-up

- Test globals (`describe`/`it`/`test`/`expect`) are left as-is with an `info`
  diagnostic — enable `test: { globals: true }` in your Vitest config or import
  them from `vitest`.
- Complex module mocks, setup files, and `jest.requireActual` need manual review.
