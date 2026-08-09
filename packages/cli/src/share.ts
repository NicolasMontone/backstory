import type { PrReport } from "./api.ts";

/**
 * The wire format published to the share service. This is a deliberately narrow
 * snapshot of a {@link PrReport}: it drops local-only fields (notably `cwd`,
 * which would leak a filesystem path) and keeps only what a public viewer needs.
 *
 * Keep this in sync with the validator in `apps/share/lib/payload.ts`.
 */
export interface SharePayload {
  version: 1;
  pr: {
    number: number;
    title: string;
    url: string;
    repo: string;
    headRefName: string;
    baseRefName: string;
  };
  sessions: Array<{
    id: string;
    provider: string;
    title: string | null;
    branch: string | null;
    startedAt: string;
    source: string | null; // "hook" | "correlated" | null
    prompts: Array<{ seq: number; text: string; ts: string | null }>;
  }>;
}

export interface ShareLink {
  id: string;
  url: string;
}

/**
 * Where the share service lives. `--endpoint` wins, then `BACKSTORY_SHARE_URL`.
 * There is no silent default: a published CLI must not quietly POST prompts to
 * `localhost`. When neither is set we throw with an actionable message (for local
 * development, set `BACKSTORY_SHARE_URL=http://localhost:3000`).
 */
export function shareEndpoint(explicit?: string): string {
  const base = explicit || process.env.BACKSTORY_SHARE_URL;
  if (!base) {
    throw new Error(
      "no share endpoint configured — set BACKSTORY_SHARE_URL (e.g. https://your-app.vercel.app) or pass --endpoint",
    );
  }
  return base.replace(/\/+$/, ""); // no trailing slash
}

/**
 * Build the public snapshot from a PR report. Pure and side-effect free so it is
 * easy to test and so callers can inspect exactly what will be published.
 */
export function buildSharePayload(report: PrReport): SharePayload {
  return {
    version: 1,
    pr: {
      number: report.pr.number,
      title: report.pr.title,
      url: report.pr.url,
      repo: report.pr.repo,
      headRefName: report.pr.headRefName,
      baseRefName: report.pr.baseRefName,
    },
    sessions: report.sessions.map((s) => ({
      id: s.id,
      provider: s.provider,
      title: s.title,
      branch: s.branch,
      startedAt: s.startedAt,
      source: s.source,
      // Strip everything else (cwd, repo, endedAt, …); publish prompts only.
      prompts: s.prompts.map((p) => ({ seq: p.seq, text: p.text, ts: p.ts })),
    })),
  };
}

/** How many prompts are in a payload — handy for messaging. */
export function promptCount(payload: SharePayload): number {
  return payload.sessions.reduce((n, s) => n + s.prompts.length, 0);
}

/**
 * POST a payload to the share service and return the resulting unguessable link.
 * The service generates the id; if it returns only an id we build the URL from
 * the endpoint so the CLI still works against a minimal endpoint.
 */
export async function createShareLink(
  payload: SharePayload,
  opts: { endpoint?: string; fetch?: typeof fetch } = {},
): Promise<ShareLink> {
  const base = shareEndpoint(opts.endpoint);
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${base}/api/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(`could not reach share service at ${base}: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `share service returned ${res.status}`);
  if (!body.id) throw new Error("share service did not return a link id");
  return { id: body.id, url: body.url ?? `${base}/s/${body.id}` };
}
