# @backstory/share

The public share service for [backstory](../../README.md). It turns a PR's prompt
trail into an **unguessable, shareable link**.

- `POST /api/links` — accepts a snapshot payload (built by `bs link`), stores it in
  Vercel Blob under a random UUID, and returns `{ id, url }`.
- `GET /s/<id>` — renders the prompts behind that PR. Read-only, no account needed.

It is intentionally tiny and **unauthenticated**: anyone with a link can read it, and
anyone can create one. The id is a v4 UUID (122 bits of entropy), so links are
unguessable, but they are public — do not share prompts you would not paste in a
public gist.

## Storage: Vercel Blob (not a database)

A link is a single immutable JSON document, written once and read occasionally,
addressed by an unguessable id. That is exactly Blob's model — no schema, no
migrations, no serverless connection pooling, and reads are CDN-cached. All of it is
isolated in [`lib/store.ts`](./lib/store.ts); swap that one file for Postgres/KV if we
ever need listing, view counts, expiry, or ownership.

## Local development

```bash
pnpm --filter @backstory/share dev
```

Storage needs a Blob token. Either link a Vercel Blob store and run
`vercel env pull .env.local`, or paste a `BLOB_READ_WRITE_TOKEN` into `.env.local`
(see `.env.example`). Then point the CLI at your local server:

```bash
BACKSTORY_SHARE_URL=http://localhost:3000 bs link 42
# or: bs link 42 --endpoint http://localhost:3000
```

## Deploying to Vercel

This is a pnpm-workspace monorepo, so set the project's **Root Directory** to
`apps/share` in the Vercel dashboard (Framework preset: Next.js). Add a Blob store to
the project — `BLOB_READ_WRITE_TOKEN` is then injected automatically. Once deployed,
have the CLI target it:

```bash
export BACKSTORY_SHARE_URL=https://your-deployment.vercel.app
bs link 42
```
