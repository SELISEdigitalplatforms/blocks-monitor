# Shared app-kit package

`seliseblocks-app-kit-0.1.1.tgz` is `@seliseblocks/app-kit`, built from its single source in
Blocks Console: `client/vendor/app-kit` on the `dev` branch. Every shared change (the app
shell, top bar, sidebar and workspace switcher, the dashboard overview hero, metadata, Bootstrap
dialog and Domains/Repositories tables, and the command palette's shared commands) is made
there, not in this repository.

`DashboardOverview` takes `showDomains` and `showRepositories` (both default to `true`);
Monitor's `/dashboard` route passes `false` for both. The command palette's View Console, View
Profile and light / dark / system theme rows come from `SHARED_COMMANDS`,
`resolveSharedCommands` and `useThemePaletteActions`.

The relative dependency lets local development and Docker install the same package without
publishing to npm. Docker copies the archive before `npm ci`.

To rebuild, from Blocks Console's `client/`:

```sh
npm ci
npm run build:app-kit
npm run pack:app-kit
```

Copy the resulting archive here, refresh its lockfile integrity, and run `npm ci` in this
repository's `client/` with npm 10 (what CI uses).
