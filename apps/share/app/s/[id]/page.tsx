import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ShareSession, SharePayload } from "@/lib/payload";
import { promptCount } from "@/lib/payload";
import { loadLink } from "@/lib/store";

// Read the freshest snapshot; the underlying blob is already CDN-cached.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getPayload(id: string): Promise<SharePayload | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    return await loadLink(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const payload = await getPayload(id);
  if (!payload) return { title: "Not found · backstory" };
  const n = promptCount(payload);
  return {
    title: `PR #${payload.pr.number} · ${payload.pr.repo} — backstory`,
    description: `${n} prompt${n === 1 ? "" : "s"} behind "${payload.pr.title}".`,
  };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SessionCard({ session }: { session: ShareSession }) {
  const provider = session.provider.toLowerCase();
  const started = session.startedAt ? fmtDate(session.startedAt) : null;
  return (
    <div className="session">
      <div className="session-head">
        <span className="session-title">{session.title || "Session"}</span>
        <span className={`badge provider-${provider}`}>{session.provider}</span>
        {session.source === "hook" && <span className="badge exact">● exact</span>}
        {session.source === "correlated" && <span className="badge correlated">~ correlated</span>}
        <span className="session-sub">
          {[session.branch, started].filter(Boolean).join(" · ")}
        </span>
      </div>
      {session.prompts.map((p) => (
        <div className="prompt" key={p.seq}>
          <p className="prompt-text">{p.text}</p>
          {p.ts && <div className="prompt-ts">{fmtDate(p.ts)}</div>}
        </div>
      ))}
    </div>
  );
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await getPayload(id);
  if (!payload) notFound();

  const { pr, sessions } = payload;
  const prompts = promptCount(payload);

  return (
    <main className="wrap">
      <div className="brand">backstory</div>

      <h1 className="pr-title">
        {pr.url ? (
          <a href={pr.url} target="_blank" rel="noreferrer">
            {pr.title}
          </a>
        ) : (
          pr.title
        )}{" "}
        <span className="num">#{pr.number}</span>
      </h1>

      <div className="pr-meta">
        {pr.repo && <span className="repo">{pr.repo}</span>}
        {pr.headRefName && (
          <span className="refs">
            {pr.headRefName} → {pr.baseRefName}
          </span>
        )}
      </div>

      <div className="summary">
        {sessions.length} session{sessions.length === 1 ? "" : "s"} · {prompts} prompt
        {prompts === 1 ? "" : "s"} that produced this pull request
      </div>

      {sessions.length === 0 ? (
        <div className="empty">No prompts were linked to this pull request.</div>
      ) : (
        sessions.map((s) => <SessionCard key={s.id || s.startedAt} session={s} />)
      )}

      <div className="footer">
        Shared with <a href="https://github.com/nicolasmontone/backstory">backstory</a> — traced from the
        commits on this PR.
      </div>
    </main>
  );
}
