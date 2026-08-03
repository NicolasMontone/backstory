# backstory

Link the prompts you gave your AI coding agents to the commits and PRs they produced.

`backstory` reads the on-disk session logs your agents already keep, indexes every
prompt you typed, and joins them to git — so you can ask *"what did I ask to get this
commit?"* or *"which prompts are behind this PR?"*.

Today it ingests **Codex** sessions (`~/.codex/sessions`). Claude Code is next; the
provider layer is built to make adding it small.

```
bs commit HEAD          # prompts behind a commit
bs pr 27901             # prompts behind a GitHub PR
bs branch my-feature    # prompts on a branch
bs search "raindrop"    # full-text search across all your prompts
bs sessions             # recent sessions
```

## How linking works (hybrid)

A commit isn't stamped with the prompt that produced it, so `backstory` links the two
in two complementary ways:

- **`~ correlated`** — inferred from every existing session by matching **repo +
  branch + time window**, restricted to commits **you** authored (your git identity).
  Works retrospectively across your whole history, zero setup.
- **`● exact`** — a git `post-commit` hook stamps the *active* session onto each new
  commit as you make it. Precise, opt-in per repo, going forward only.

Install the hook in a repo to get exact links there:

```bash
bs hook install
```

## Setup

Requires [Bun](https://bun.sh) (the CLI runs on it) and `git`. `bs pr` also needs the
[`gh`](https://cli.github.com) CLI, authenticated.

```bash
pnpm install
# run without linking:
pnpm bs ingest
# or link `bs` onto your PATH:
cd packages/cli && bun link
```

Run `bs ingest` first, and again after new agent work, to refresh the index. Use
`bs ingest --full` to rebuild from scratch.

## Data

The index is a local SQLite DB at `~/.backstory/backstory.db` (override with
`BACKSTORY_DB`). Nothing leaves your machine; `bs pr` is the only command that talks to
the network, via your local `gh`.

## Layout

pnpm monorepo:

- `packages/cli` — the `bs` CLI (Bun + `bun:sqlite`).
- `apps/` — reserved for future apps (e.g. a landing page / web viewer).

Provider parsers live in `packages/cli/src/providers/`. To add an agent, implement the
`Provider` interface in `providers/types.ts`.
