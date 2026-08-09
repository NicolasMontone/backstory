# backstory

Trace the prompts given to your coding agents to the sessions, commits, branches,
and pull requests they produced.

Backstory reads the local logs already written by Codex and Claude Code, stores a
searchable SQLite index, and joins that history with Git. It is designed for questions
like:

- What prompts led to this commit?
- Which sessions contributed to this branch or PR?
- What was I asking my agents about last week?
- Which prompts were linked exactly, and which were inferred?

Everything is local by default. The only network-backed commands are `bs pr` and
`bs link`, which use your authenticated local `gh` CLI to read GitHub data; `bs link`
additionally publishes a read-only snapshot to your own share service.

## Quick start

Requirements:

- [Bun](https://bun.sh) 1.1+
- Git
- `gh` authenticated with GitHub, only if you use `bs pr`

From a checkout of this repository:

```bash
pnpm install
pnpm bs ingest
pnpm bs web
```

`bs web` starts the local dashboard at `http://localhost:4319`. To start the API
without opening a browser:

```bash
pnpm bs web --no-open
```

The CLI can also be linked onto your PATH:

```bash
cd packages/cli
bun link
```

Then use `bs ...` instead of `pnpm bs ...`.

## CLI commands

Run `bs ingest` once before querying and again after new agent work. Use
`--full` when you need to rebuild the index from all available provider logs.

```bash
bs ingest                         # incremental parse + Git correlation
bs ingest --full                  # rebuild the local index
bs ingest --since 2026-08-01      # ingest from a timestamp
bs ingest --author you@example.com # override the Git identities considered yours

bs commit HEAD                    # prompts behind the current commit
bs commit abc123 --full           # full prompts for a specific commit
bs branch my-feature              # prompts found on a branch
bs branch my-feature --repo org/app
bs pr 27901                       # prompts behind a GitHub PR
bs link 27901                     # publish a PR's prompts to an unguessable share link
bs sessions --limit 50             # recent sessions
bs session <session-id>            # all prompts and linked commits in one session
bs search "raindrop"               # full-text search across prompts
bs stats                           # index totals and breakdowns
```

Every read command supports `--json`, which is the preferred interface for scripts
and agents:

```bash
bs commit HEAD --json
bs search "deployment" --json | jq '.[].text'
bs session <session-id> --json
```

Human-readable reports show link provenance:

- `● exact` means a Git post-commit hook recorded the active session directly.
- `~ correlated` means Backstory inferred the relationship from repository, branch,
  authorship, and time window.

## Exact commit links

Correlation works retrospectively, but exact links require installing Backstory's
Git post-commit hook in each repository where you want precise attribution:

```bash
cd /path/to/repository
bs hook status
bs hook install
```

The hook is agent-agnostic and preserves an existing user hook. It records the active
session after a commit; it does not rewrite commit history. To inspect or manually
record a link:

```bash
bs hook status --json
bs hook record
```

## Web dashboard

The dashboard has two views:

- **Prompts**: search and browse sessions, with provider, repository, branch, prompt
  count, sorting, and prompt-level linked commits.
- **Observability**: activity over time for prompts, sessions, and commits, separated
  by provider.

For frontend development:

```bash
pnpm --filter @backstory/web build
pnpm --filter @backstory/web dev
```

The Vite app proxies `/api/*` to a running `bs web` server.

## Share links

`bs link <pr>` publishes the prompts behind a PR to an **unguessable, shareable link**
you can send to anyone — no account required on either end.

```bash
bs link 27901
# PR #27901 Add export button
#   2 session(s) · 7 prompt(s) published
#
#   ● https://your-deployment.vercel.app/s/6f1c…-…-…
```

Under the hood it runs the same PR correlation as `bs pr` (via `gh`), then POSTs a
snapshot — PR metadata plus each session's prompts — to a small share service. Local
paths (`cwd`) are stripped; only the prompts are published. The link id is a v4 UUID,
so it is unguessable, but the page is public: don't share prompts you wouldn't paste
in a public gist.

The service is a minimal Next.js app in [`apps/share`](apps/share) that stores each
snapshot as a single JSON object in **Vercel Blob** (no database) and renders it at
`/s/<id>`. Point the CLI at your deployment:

```bash
export BACKSTORY_SHARE_URL=https://your-deployment.vercel.app
bs link 27901
# or per-invocation: bs link 27901 --endpoint https://your-deployment.vercel.app
```

See [`apps/share/README.md`](apps/share/README.md) for deploying it to Vercel.

## How it works

Built-in providers parse:

- Codex sessions from `~/.codex/sessions`
- Claude Code sessions from `~/.claude/projects`

The provider layer normalizes sessions and prompts into SQLite. Git correlation then
matches commits authored by you to sessions using repository, branch, and time-window
signals. Exact hook links take precedence over inferred links.

The database lives at `~/.backstory/backstory.db`. Set `BACKSTORY_DB` to use another
location. Agent logs and the database remain on disk; Backstory does not upload them.

## Programmatic API

The CLI package exports the typed `Backstory` facade for applications such as the web
dashboard:

```ts
import { Backstory } from "@backstory/cli";

using bs = Backstory.open();
await bs.ingest();
const report = bs.commitReport("HEAD");
```

Useful methods include `sessions`, `session`, `sessionCommits`, `commitReport`,
`branchReport`, `prReport`, `search`, `stats`, and `activityTimeline`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm --filter @backstory/cli test
pnpm --filter @backstory/web build
```

Repository layout:

- `packages/cli` — Bun CLI, SQLite index, providers, Git correlation, hooks, and API
- `apps/web` — React/Vite dashboard
- `apps/share` — Next.js share service (`bs link`), deployed to Vercel with Blob storage
- `.agents/skills/backstory-cli` — instructions for coding agents using Backstory

To add an agent provider, implement a provider in `packages/cli/src/providers` and
register it in `providers/index.ts`. To add an exact-link mechanism, implement a
`HookProvider` and register it in `hooks/index.ts`.
