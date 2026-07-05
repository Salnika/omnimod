# moment → dayjs

`@omnimod/plugin-moment-to-dayjs` migrates a [Moment.js](https://momentjs.com)
codebase to [Day.js](https://day.js.org). Day.js mirrors most of Moment's
chained API, so once the base import and binding are repointed, the call chains
carry over unchanged.

```bash
omnimod run moment-to-dayjs "src/**/*.{ts,tsx,js,jsx}" --write
```

The target project needs `dayjs` installed (and, for the flagged APIs below, the
relevant Day.js plugins).

## Example

```ts
// before
import moment from "moment";
export const d = moment("2020-01-01").add(1, "day").format("YYYY-MM-DD");

// after
import dayjs from "dayjs";
export const d = dayjs("2020-01-01").add(1, "day").format("YYYY-MM-DD");
```

## Automated

- Repoints the `moment` import source to `dayjs`.
- Renames the default binding `moment` → `dayjs` (import specifier **and** every
  call site). An aliased default (`import m from "moment"`) keeps its name and
  only has its source repointed.
- Rewrites the type-only `{ Moment }` import (and its annotations) to `{ Dayjs }`.
- API-mirrored chained methods (`.format`, `.add`, `.subtract`, `.diff`,
  `.isBefore`, `.isAfter`, `.toDate`, `.unix`, …) carry over untouched.

## Flagged for follow-up

APIs that Day.js only exposes through a plugin are **not** removed — the renamed
call is correct once the plugin is registered. Each gets a `warn` diagnostic and
a `// TODO(omnimod)` line naming the plugin to add:

- `moment.utc()` → `dayjs/plugin/utc`
- `moment.duration()` → `dayjs/plugin/duration`
- `.fromNow()` / `.from()` / `.to()` → `dayjs/plugin/relativeTime`
- `.calendar()` → `dayjs/plugin/calendar`
- `.isBetween()` → `dayjs/plugin/isBetween`
- locale loading → explicit `import "dayjs/locale/<name>"`
