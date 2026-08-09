# Changelog

## Unreleased

- `bs link <pr>`: publish a PR's prompts to an unguessable, shareable link. Reuses the
  `bs pr` correlation, strips local paths, and POSTs a snapshot to a share service
  (`BACKSTORY_SHARE_URL` / `--endpoint`).
- `apps/share`: minimal Next.js share service that stores each snapshot in Vercel Blob
  (no database) and renders it at `/s/<id>`. Unauthenticated by design.
- Codex and Claude Code session providers (pluggable via `JsonlSessionProvider`).
- Hybrid prompt→commit linking: `correlated` (repo + branch + time + author) and
  `exact` (git post-commit hook).
- Pluggable `HookProvider` layer; `bs hook install` / `bs hook status`.
- Type-safe `Backstory` API and `--json` output on every read command.
