---
name: backstory-cli
description: Use the Backstory CLI in this repository to inspect AI-agent prompts, sessions, commits, branches, pull requests, search results, and prompt-to-commit attribution. Trigger when an agent needs to trace work back to prompts, refresh the local index, investigate exact versus correlated links, or query Backstory programmatically.
---

# Backstory CLI

Use Backstory to answer provenance questions about Codex and Claude Code work. Run
commands from the repository root. Prefer `pnpm bs ...` when `bs` is not installed on
the PATH.

## Safe workflow

1. Check whether the local index exists and is current enough for the question.
2. Run `pnpm bs ingest` when new agent work may be missing. This updates the local
   SQLite index; use `--full` only when a rebuild is needed.
3. Query the narrowest relevant object: commit, branch, PR, session, or search term.
4. Use `--json` for parsing, filtering, or passing results into another tool.
5. Report whether each relationship is `exact` or `correlated`; do not present an
   inferred relationship as proof.

Read-only queries:

```bash
pnpm bs stats
pnpm bs sessions --limit 20 --json
pnpm bs commit HEAD --json
pnpm bs branch <branch> --repo <owner/name> --json
pnpm bs session <session-id> --json
pnpm bs search "<terms>" --json
pnpm bs pr <number> --repo <owner/name> --json
```

`bs pr` requires an authenticated local `gh` CLI and may contact GitHub. Confirm the
repository and PR before using it if the user did not specify them.

## Choosing a query

- “What prompted this change?” → `bs commit <sha-or-rev> --json`.
- “What work happened on this branch?” → `bs branch <branch> --repo <owner/name> --json`.
- “What prompts are behind this PR?” → `bs pr <number> --repo <owner/name> --json`.
- “Show the complete conversation” → `bs session <id> --json`.
- “Find where I discussed X” → `bs search "X" --json`.
- “How much activity is indexed?” → `bs stats --json`.

For commit reports, inspect `sessions[].prompts[]`. For session reports, inspect both
`session.prompts[]` and `commits[]`. For a PR report, inspect the returned PR metadata
and its associated sessions.

## Attribution rules

- `exact` / `source: "hook"`: the Git post-commit hook recorded the active session.
- `correlated` / `source: "correlated"`: Backstory inferred the link from repository,
  branch, authorship, and timing.
- No link: do not invent one from similar wording or proximity alone.

When a user needs precise future attribution, explain that it must be enabled per Git
repository:

```bash
bs hook status
bs hook install
```

Installing a hook changes the repository's Git hooks. Do it only when the user asks or
clearly authorizes exact-link setup. `bs hook record` records the active session for a
commit and also changes local index state.

## Refresh and troubleshooting

```bash
pnpm bs ingest                 # incremental refresh
pnpm bs ingest --full          # rebuild all provider data
pnpm bs ingest --json          # machine-readable ingest summary
pnpm bs web --no-open          # local dashboard without opening a browser
```

If results are empty, check that provider logs exist under `~/.codex/sessions` or
`~/.claude/projects`, run an ingest, and then retry the query. If correlations are
unexpected, verify the session repository, branch, timestamps, and Git author identity
before changing correlation behavior.

## Output discipline

Keep prompt text private: return only the excerpts needed to answer the user's
question. Avoid dumping the entire index. Use bounded queries (`--limit`) and JSON
projection with `jq` when appropriate, for example:

```bash
pnpm bs commit HEAD --json \
  | jq '.sessions[] | {title, source, prompts: [.prompts[].text]}'
```
