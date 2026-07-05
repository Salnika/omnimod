# Getting started

## Install

Use the CLI directly from npm:

```bash
pnpm dlx @omnimod/cli run <plugin> "src/**/*.tsx"
```

For local development, run it from a checkout:

```bash
git clone https://github.com/salnika/omnimod
cd omnimod
pnpm install
vp run -r build
```

## Run a codemod

The CLI is **dry-run by default** — it prints a colored diff and writes nothing.
Add `--write` to apply.

```bash
# Dry-run: preview the changes
omnimod run styled-to-vanilla-extract "src/**/*.{tsx,jsx}"

# Apply, then format with your project's formatter
omnimod run styled-to-vanilla-extract "src/**/*.{tsx,jsx}" --write
```

From a checkout (no global install), invoke the built binary directly:

```bash
node /path/to/omnimod/packages/cli/dist/index.mjs \
  run styled-to-vanilla-extract "src/**/*.tsx" --cwd /path/to/your/project
```

## Recommended workflow

The tool is designed to never emit broken code, but always review:

1. Work on a throwaway branch in the target project.
2. **Dry-run first**, read the diff and the diagnostics.
3. `--write`, then `git diff` before committing.
4. If anything couldn't be fully converted, the run writes a
   [`MIGRATION.md`](/plugins/styled-to-vanilla-extract#migration-md) — follow it
   (or hand it to an AI agent) to finish.

See the [CLI reference](/guide/cli) for all flags, and
[Authoring a plugin](/guide/authoring-plugins) to build your own.
