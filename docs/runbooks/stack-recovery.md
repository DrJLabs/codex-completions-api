# Stack Recovery (Snapshot / Rollback)

This repo provides snapshot/rollback helpers intended for operator use.

## Snapshot

```bash
npm run ops:snapshot
```

Preview only:

```bash
npm run snapshot:dry-run
```

## Rollback

```bash
npm run ops:rollback
```

Environment-specific:

```bash
npm run ops:rollback:prod
npm run ops:rollback:dev
```

## Reference

See `../ops/runbooks.md` for a fuller overview and related commands.
