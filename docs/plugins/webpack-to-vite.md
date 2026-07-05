# webpack → vite

`@omnimod/plugin-webpack-to-vite` scaffolds a [Vite](https://vitejs.dev) config
from an existing `webpack.config.js`. A webpack config can contain arbitrary
JavaScript, so this plugin reads what it can **statically** and writes the rest
into a migration guide — it never rewrites the webpack config itself.

```bash
omnimod run webpack-to-vite "webpack.config.js" --write
```

## What it emits

Next to the webpack config, two files are created (nothing is changed in place):

- **`vite.config.js`** — a skeleton derived from the statically-readable fields:
  `entry`, `resolve.alias`, `resolve.extensions`, `DefinePlugin` values, common
  loaders mapped to their Vite equivalents.
- **`WEBPACK_MIGRATION.md`** — a checklist written for an AI agent (or you) to
  finish the migration: everything that couldn't be resolved statically
  (function/array-returning configs, custom plugins, non-trivial `alias` values),
  plus verification steps.

## Automated (best-effort, static)

- `entry`, `output`
- `resolve.alias` (string values) and `resolve.extensions`
- `DefinePlugin` → Vite `define`
- `devServer.port` / `devServer.proxy`
- common loader rules → Vite equivalents

## Flagged for follow-up

- Function- or array-returning configs (`module.exports = (env) => …`) can't be
  resolved statically — noted in `WEBPACK_MIGRATION.md`.
- Custom webpack plugins, non-trivial alias values (`path.resolve(...)`), and
  anything else is enumerated in the guide with next steps.
