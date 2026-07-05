# styled-components → vanilla-extract

`@omnimod/plugin-styled-to-vanilla-extract` converts a styled-components codebase
to [vanilla-extract](https://vanilla-extract.style). For each convertible
`styled.tag` it generates a sibling `<File>.css.ts` and rewrites the JSX usages
inline.

```bash
omnimod run styled-to-vanilla-extract "src/**/*.{tsx,jsx}" --write
```

The target project needs `@vanilla-extract/css`, `@vanilla-extract/recipes`,
`@vanilla-extract/dynamic` and `clsx` installed.

## Example

```tsx
// before — App.tsx
import styled from "styled-components";

const Card = styled.div`
  color: red;
  &:hover {
    color: blue;
  }
  & .icon {
    color: green;
  }
`;

const view = <Card className="foo">…</Card>;
```

```ts
// after — App.css.ts
import { globalStyle, style } from "@vanilla-extract/css";

export const card = style({
  color: "red",
  selectors: { "&:hover": { color: "blue" } },
});
globalStyle(`${card} .icon`, { color: "green" });
```

```tsx
// after — App.tsx
import clsx from "clsx";
import { card } from "./App.css";

const view = <div className={clsx(card, "foo")}>…</div>;
```

## Support matrix

| Pattern                                                                    | Status     |
| -------------------------------------------------------------------------- | ---------- |
| `styled.tag`...``(static) →`style()`                                       | ✅         |
| `&:hover`, `::before`, `&.active`, `.parent &` → `selectors`               | ✅         |
| `@media (...)` → `@media` key                                              | ✅         |
| Descendant selectors (`& .child`, bare `a`) → `globalStyle()`              | ✅         |
| `createGlobalStyle` → `globalStyle()` (removes `<GlobalStyle />`)          | ✅         |
| Inline JSX rewrite (`<Card>` → `<div className={…}>`, merges className)    | ✅         |
| `keyframes` → `keyframes()` (+ `${anim}` references)                       | ✅         |
| Discrete props (`${p => p.x ? a : b}`, `===` chains) → `recipe()` variants | ✅         |
| Continuous props (`${p => p.n}`) → `createVar()` + `assignInlineVars`      | ✅         |
| Mixed values (`border: solid 1px ${x}`) → template literals                | ✅         |
| Theme access + computed tokens (`theme.colors.blueGrey[900]`) → `vars…`    | ✅         |
| Conditional blocks (`${p => p.on && css`...`}`) → boolean variant          | ✅         |
| `css`...`` fragment composition (`${frag}`spread) →`clsx(frag, …)`         | ✅         |
| Cross-file rewrite of **exported** styled components                       | ✅         |
| `styled(Base)` composition (inherits tag, composes base)                   | ✅         |
| `.attrs(...)`, the `as` prop                                               | 🚧 roadmap |
| Function calls / logical fallbacks (`p.x \|\| y`) in interpolations        | 🚧 roadmap |

Anything not converted is **reported and left untouched** — the codemod never
emits broken code. Unconvertible interpolations leave a `// TODO(omnimod)`
comment.

## Theme

Theme access maps to a `vars` contract written to **`omnimod-theme.css.ts`** (a
distinct name so it never clobbers an existing `theme.css.ts`). It's a
`createThemeContract` with `null` leaves — fill in real values:

```ts
import { createTheme } from "@vanilla-extract/css";
import { vars } from "./omnimod-theme.css";

export const themeClass = createTheme(vars, {
  /* same shape as vars, with real values */
});
```

## `MIGRATION.md`

Whenever anything can't be fully converted, the run also generates a root
**`MIGRATION.md`** — an agent-ready guide listing the one-time setup, the theme
tokens to fill in, and every remaining task grouped by category (`.attrs`/`as`,
`// TODO(omnimod)` interpolations, prop-conditionals in a nested selector,
descendant-in-recipe) with step-by-step instructions and the affected files.
Hand it to an AI agent (or read it yourself) to finish the job.

## Known limitations

Within the implemented set, review the generated `.css.ts` if you use these:

- a descendant selector nested inside `@media` is emitted as a top-level
  `globalStyle` without the media guard;
- two blocks sharing the same `@media` condition or `&`-selector collapse (last
  wins);
- a styled component imported alongside a default (`import D, { Styled }`) isn't
  repointed cleanly.
