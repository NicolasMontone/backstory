/**
 * The wire format accepted by `POST /api/links` and rendered by `/s/[id]`.
 *
 * This mirrors `SharePayload` in `packages/cli/src/share.ts`. Because the create
 * endpoint is unauthenticated, everything coming in is treated as untrusted:
 * {@link validateSharePayload} coerces, trims, and caps every field so what we
 * persist and later render is always bounded and well-shaped.
 */
export interface SharePrompt {
  seq: number;
  text: string;
  ts: string | null;
}

export interface ShareSession {
  id: string;
  provider: string;
  title: string | null;
  branch: string | null;
  startedAt: string;
  source: string | null; // "hook" | "correlated" | null
  prompts: SharePrompt[];
}

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
  sessions: ShareSession[];
}

export const LIMITS = {
  sessions: 200,
  promptsPerSession: 1000,
  promptChars: 100_000,
} as const;

export type ValidateResult = { ok: true; payload: SharePayload } | { ok: false; error: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const nstr = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

/** Only http(s) links are kept, so a rendered PR link can never be a javascript: URL. */
function safeUrl(v: unknown): string {
  if (typeof v !== "string") return "";
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString().slice(0, 500) : "";
  } catch {
    return "";
  }
}

export function validateSharePayload(input: unknown): ValidateResult {
  const err = (error: string): ValidateResult => ({ ok: false, error });
  if (!input || typeof input !== "object") return err("payload must be an object");
  const o = input as Record<string, unknown>;
  if (o.version !== 1) return err("unsupported payload version");

  const pr = o.pr as Record<string, unknown> | undefined;
  if (!pr || typeof pr !== "object") return err("missing pr");
  if (typeof pr.number !== "number" || !Number.isFinite(pr.number)) return err("pr.number must be a number");

  if (!Array.isArray(o.sessions)) return err("sessions must be an array");
  if (o.sessions.length > LIMITS.sessions) return err(`too many sessions (max ${LIMITS.sessions})`);

  const sessions: ShareSession[] = o.sessions.map((raw): ShareSession => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const prompts = Array.isArray(s.prompts) ? s.prompts : [];
    return {
      id: str(s.id, 200),
      provider: str(s.provider, 50),
      title: nstr(s.title, 500),
      branch: nstr(s.branch, 500),
      startedAt: str(s.startedAt, 40),
      source: nstr(s.source, 40),
      prompts: prompts.slice(0, LIMITS.promptsPerSession).map((rawP, i): SharePrompt => {
        const p = (rawP ?? {}) as Record<string, unknown>;
        return {
          seq: typeof p.seq === "number" ? p.seq : i,
          text: str(p.text, LIMITS.promptChars),
          ts: nstr(p.ts, 40),
        };
      }),
    };
  });

  return {
    ok: true,
    payload: {
      version: 1,
      pr: {
        number: pr.number,
        title: str(pr.title, 500),
        url: safeUrl(pr.url),
        repo: str(pr.repo, 200),
        headRefName: str(pr.headRefName, 300),
        baseRefName: str(pr.baseRefName, 300),
      },
      sessions,
    },
  };
}

export function promptCount(payload: SharePayload): number {
  return payload.sessions.reduce((n, s) => n + s.prompts.length, 0);
}
