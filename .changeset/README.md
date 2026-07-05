# Changesets

Add one changeset for each user-visible package change:

```bash
pnpm changeset
```

Before tagging a release, apply the pending version intents:

```bash
pnpm run version:apply
```

The local release planner also bumps dependent `@omnimod/*` packages as patch
releases, so a core change automatically chains through `plugin-utils`, plugins,
and the CLI.
