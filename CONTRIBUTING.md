# Contributing to omnimod

Thanks for your interest! omnimod is a modular codemod tool: a small **core**
plus **plugins**. Contributions to the core, `plugin-utils`, the CLI, existing
plugins, or brand-new plugins are all welcome.

## Setup

This is a pnpm + [Vite+](https://viteplus.dev) monorepo. The `vp` CLI wraps the
toolchain (Vitest, tsdown, Oxlint, Oxfmt).

```bash
pnpm install          # or: vp install
vp run -r test        # run all package tests
vp check              # format + lint + type-check
vp check --fix        # auto-fix formatting
vp run -r build       # build every package
pnpm run ready        # check + test + build (what CI runs)
```

Docs live in `docs/` (a standalone VitePress site, installed separately):

```bash
npm --prefix docs install
npm --prefix docs run dev
```

## Project layout

| Path                    | What                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `packages/core`         | Engine: parse, walk, the `Plugin` contract, `run()`, formatting. |
| `packages/plugin-utils` | Helpers for plugin authors (CSS parsing, VE model, imports).     |
| `packages/cli`          | The `omnimod` command.                                           |
| `packages/plugin-*`     | Plugins.                                                         |
| `docs/`                 | VitePress documentation.                                         |

## Authoring a plugin

A plugin is an object satisfying `Plugin` from `@omnimod/core`. Use `definePlugin`
for type inference, and the `analyze` → `transform` → `finalize` lifecycle for
cross-file work. See **Authoring a plugin** in the docs for the full contract.

Publish (or name a local package) as `@omnimod/plugin-<name>` or
`omnimod-plugin-<name>` so `omnimod run <name>` resolves it automatically.

## Pull requests

- Keep changes focused; match the surrounding style (enforced by `vp check`).
- Add or update tests — plugins are tested with input → output fixtures.
- For user-visible package changes, run `pnpm changeset` and commit the generated
  `.changeset/*.md` file. CI checks that changed packages have a version intent.
- Run `pnpm run ready` before pushing; it must be green.
- Write clear commit messages (conventional-commit prefixes are appreciated).

## Releases

Versioning uses committed changesets, similar to Yarn's deferred release
workflow:

```bash
pnpm changeset
pnpm run version:plan
pnpm run version:apply
pnpm install --lockfile-only
git add .
git commit -m "chore: version packages"
git tag v0.1.1
git push origin master v0.1.1
```

`version:apply` bumps the packages listed in changesets and automatically chains
patch releases through internal dependents. For example, a `@omnimod/core`
changeset also releases `@omnimod/plugin-utils`, the plugins, and `@omnimod/cli`.
Pushing a `v*` or `release-*` tag runs the release workflow, which publishes only
package versions that are not already on npm, in dependency order.

By contributing you agree your work is licensed under the project's MIT license.
