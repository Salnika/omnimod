# lodash → es-toolkit

`@omnimod/plugin-lodash-to-es-toolkit` migrates named
[lodash](https://lodash.com) imports to [es-toolkit](https://es-toolkit.dev), or
to a safe native equivalent where one exists. Helpers with divergent semantics
are left on `lodash` so behaviour never silently changes.

```bash
omnimod run lodash-to-es-toolkit "src/**/*.{ts,tsx,js,jsx}" --write
```

The target project needs `es-toolkit` installed (and `lodash` kept for any
residual imports).

## Example

```ts
// before
import { debounce, isArray } from "lodash";
export const f = debounce(() => {}, 100);
export const a = isArray([]);

// after
import { debounce } from "es-toolkit";
export const f = debounce(() => {}, 100);
export const a = Array.isArray([]);
```

## Automated

- Named imports supported 1:1 by es-toolkit are moved there.
- Safe native replacements are inlined (`isArray` → `Array.isArray`, …) and their
  usages rewritten.
- Unsupported names are **split off** to a residual `lodash` import rather than
  dropped, so the module still type-checks and runs.

## Flagged for follow-up

- Helpers whose es-toolkit/native semantics diverge from lodash (`get`, `set`,
  `has`, object-shaped collection ops) are kept on `lodash` with a diagnostic.
- Default-import usage (`import _ from "lodash"; _.x(...)`) is flagged with a
  `// TODO(omnimod)` — convert to named imports first.
