import { randomUUID } from "node:crypto";
import { validateSharePayload } from "@/lib/payload";
import { saveLink } from "@/lib/store";

// node:crypto + the Blob SDK both run happily on the Node.js runtime.
export const runtime = "nodejs";

// The unauthenticated create endpoint. Kept deliberately small: validate, cap,
// mint an unguessable id, store, return the link. No auth or rate limiting yet.
const MAX_BYTES = 2_000_000; // 2 MB of JSON is plenty for a PR's prompts.

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Public origin, honoring Vercel's proxy headers, so returned links are correct. */
function originOf(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
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
