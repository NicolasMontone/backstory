import { list, put } from "@vercel/blob";
import type { SharePayload } from "./payload";

/**
 * Storage for shared links, backed by Vercel Blob.
 *
 * Why Blob and not a database: a link is a single, immutable JSON snapshot,
 * written once and read occasionally, addressed by an unguessable id. That is
 * exactly Blob's model — no schema, no migrations, no connection pooling in a
 * serverless function, and reads are CDN-cached. If we ever need listing,
 * per-link view counts, expiry, or ownership, this is the one module to swap
 * for Postgres/KV; nothing else in the app knows how links are stored.
 */

const PREFIX = "links/";
const pathOf = (id: string) => `${PREFIX}${id}.json`;

/** Persist a payload under `id`. The pathname is deterministic (no random suffix). */
export async function saveLink(id: string, payload: SharePayload): Promise<void> {
  await put(pathOf(id), JSON.stringify(payload), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    // The snapshot never changes, so let the CDN keep it for a year.
    cacheControlMaxAge: 31_536_000,
  });
}

/**
 * Load a payload by id, or null if there is no such link.
 *
 * Blob has no "get by pathname" call, so we resolve the pathname to its public
 * URL via `list` (ids are UUIDs, so the prefix is unique) and then fetch it.
 */
export async function loadLink(id: string): Promise<SharePayload | null> {
  const path = pathOf(id);
  const { blobs } = await list({ prefix: path, limit: 1 });
  const blob = blobs.find((b) => b.pathname === path);
  if (!blob) return null;
  const res = await fetch(blob.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as SharePayload;
}
