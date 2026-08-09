import { randomUUID } from "node:crypto";
import { validateSharePayload } from "@/lib/payload";
import { saveLink } from "@/lib/store";

// The unauthenticated create endpoint. Kept deliberately small: validate, cap,
// mint an unguessable id, store, return the link. No auth or rate limiting yet.
const MAX_BYTES = 2_000_000; // 2 MB of JSON is plenty for a PR's prompts.

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Public origin for the returned link. Prefer a configured canonical origin so
 * the host can't be spoofed via `x-forwarded-host`: `BACKSTORY_PUBLIC_URL` wins,
 * then Vercel's own `VERCEL_PROJECT_PRODUCTION_URL`, and only as a last resort do
 * we fall back to the request URL's origin (dev / preview).
 */
function originOf(req: Request): string {
  const configured = process.env.BACKSTORY_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return new URL(req.url).origin;
}

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: "payload too large" }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const result = validateSharePayload(parsed);
  if (!result.ok) return json({ error: result.error }, 400);

  const id = randomUUID();
  try {
    await saveLink(id, result.payload);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    return json({ error: `could not store link: ${detail}` }, 500);
  }

  return json({ id, url: `${originOf(req)}/s/${id}` }, 201);
}
