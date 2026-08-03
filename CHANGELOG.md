# Changelog

## Unreleased

- Codex and Claude Code session providers (pluggable via `JsonlSessionProvider`).
- Hybrid prompt→commit linking: `correlated` (repo + branch + time + author) and
  `exact` (git post-commit hook).
- Pluggable `HookProvider` layer; `bs hook install` / `bs hook status`.
- Type-safe `Backstory` API and `--json` output on every read command.
