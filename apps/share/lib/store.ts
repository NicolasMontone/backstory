import { get, put } from "@vercel/blob";
import type { SharePayload } from "./payload";

/**
 * Storage for shared links, backed by Vercel Blob (private store).
 *
 * Why Blob and not a database: a link is a single, immutable JSON snapshot,
 * written once and read occasionally, addressed by an unguessable id. That is
 * exactly Blob's model — no schema, no migrations, no connection pooling in a
 * serverless function. If we ever need listing, per-link view counts, expiry, or
 * ownership, this is the one module to swap for Postgres/KV; nothing else in the
 * app knows how links are stored.
 *
 * The store is PRIVATE: blob URLs are never publicly reachable. The snapshot is
 * only ever read back server-side (in `/s/[id]` and metadata) via `get()`, so
 * the raw blob URL is never exposed to a client. The link stays unguessable both
 * because the id is a UUID and because the underlying object has no public URL.
 */

const PREFIX = "links/";
const pathOf = (id: string) => `${PREFIX}${id}.json`;

/** Persist a payload under `id`. The pathname is deterministic (no random suffix). */
export async function saveLink(id: string, payload: SharePayload): Promise<void> {
  await put(pathOf(id), JSON.stringify(payload), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    // The snapshot never changes, so let the CDN keep it for a year.
    cacheControlMaxAge: 31_536_000,
  });
}

/**
 * Load a payload by id, or null if there is no such link.
 *
 * `get()` resolves the deterministic pathname directly (one hop, no `list`) and
 * streams the private object back to us on the server.
 */
export async function loadLink(id: string): Promise<SharePayload | null> {
  const result = await get(pathOf(id), { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text) as SharePayload;
  } catch {
    return null;
  }
}
