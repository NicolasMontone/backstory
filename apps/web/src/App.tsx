import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SearchHit, type SessionListItem, type SessionWithPrompts, type Stats } from "./api.ts";

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

function Header({ stats }: { stats: Stats | null }) {
  return (
    <header className="header">
      <span className="wordmark">
        backstory<span className="dot">.</span>
      </span>
      {stats && (
        <div className="stats">
          <span>
            <b>{stats.sessions}</b> sessions
          </span>
          <span>
            <b>{stats.prompts}</b> prompts
          </span>
          <span className="exact">
            <b>{stats.linksExact}</b> exact
          </span>
          <span className="corr">
            <b>{stats.linksCorrelated}</b> correlated
          </span>
        </div>
      )}
    </header>
  );
}

function SessionRow({
  s,
  active,
  onClick,
}: {
  s: SessionListItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`row ${active ? "active" : ""}`} onClick={onClick}>
      <div className="title">{s.title || s.id}</div>
      <div className="meta">
        <Badge kind={s.provider}>{s.provider}</Badge>
        <span>{s.repo ?? "no-repo"}</span>
        {s.branch && <span className="sep">·</span>}
        {s.branch && <span>{s.branch}</span>}
        <span className="sep">·</span>
        <span>{s.promptCount}p</span>
      </div>
    </div>
  );
}

function Detail({ session }: { session: SessionWithPrompts | null }) {
  if (!session) return <div className="empty">Select a session to see its prompts →</div>;
  return (
    <div>
      <h1>{session.title || session.id}</h1>
      <div className="subline">
        <Badge kind={session.provider}>{session.provider}</Badge>
        {session.source && <Badge kind={session.source === "hook" ? "exact" : "corr"}>{session.source === "hook" ? "exact" : "correlated"}</Badge>}
        <span>{session.repo ?? "no-repo"}</span>
        {session.branch && <span className="sep">·</span>}
        {session.branch && <span>{session.branch}</span>}
        <span className="sep">·</span>
        <span>{fmtDate(session.startedAt)}</span>
      </div>
      <div className="label">{session.prompts.length} prompt{session.prompts.length === 1 ? "" : "s"}</div>
      {session.prompts.map((p) => (
        <div className="prompt" key={p.seq}>
          <div className="num">#{p.seq}{p.ts ? ` · ${fmtDate(p.ts)}` : ""}</div>
          <div className="text">{p.text}</div>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionWithPrompts | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.sessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!query.trim()) {
      setHits(null);
      return;
    }
    debounce.current = setTimeout(() => {
      api.search(query.trim()).then(setHits).catch(() => setHits([]));
    }, 180);
  }, [query]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    api.session(selectedId).then(setDetail).catch(() => setDetail(null));
  }, [selectedId]);

  const searching = hits !== null;
  const grouped = useMemo(() => sessions, [sessions]);

  return (
    <div className="app">
      <Header stats={stats} />
      <div className="main">
        <aside className="sidebar">
          <div className="searchbar">
            <input
              placeholder="search prompts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="list">
            {searching
              ? hits!.map((h) => (
                  <div
                    className={`row ${selectedId === h.sessionId ? "active" : ""}`}
                    key={`${h.sessionId}-${h.seq}`}
                    onClick={() => setSelectedId(h.sessionId)}
                  >
                    <div className="hit">
                      <div className="snippet" dangerouslySetInnerHTML={{ __html: escapeSnippet(h.text) }} />
                    </div>
                    <div className="meta">
                      <span>{h.title ?? h.sessionId}</span>
                      <span className="sep">·</span>
                      <span>{h.repo ?? "no-repo"}</span>
                    </div>
                  </div>
                ))
              : grouped.map((s) => (
                  <SessionRow key={s.id} s={s} active={s.id === selectedId} onClick={() => setSelectedId(s.id)} />
                ))}
            {searching && hits!.length === 0 && <div className="empty">no matches</div>}
          </div>
        </aside>
        <section className="detail">
          <Detail session={detail} />
        </section>
      </div>
    </div>
  );
}

/** FTS returns snippets wrapped in [ ] around matches; render those as <mark>. */
function escapeSnippet(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\[([^\]]*)\]/g, "<mark>$1</mark>");
}
