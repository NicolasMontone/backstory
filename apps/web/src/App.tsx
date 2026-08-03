import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ActivityPoint, type LinkedCommit, type SearchHit, type SessionListItem, type SessionWithPrompts, type Stats } from "./api.ts";

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

function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let plainLines: string[] = [];

  const flushPlain = () => {
    if (plainLines.length === 0) return;
    const start = blocks.length;
    blocks.push(
      <span className="markdown-lines" key={`lines-${start}`}>
        {plainLines.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderInlineMarkdown(line)}
          </span>
        ))}
      </span>
    );
    plainLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (isBoxTableBorder(lines[i])) {
      flushPlain();
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i].includes("│") || isBoxTableBorder(lines[i]))) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;
      const tableRows = tableLines
        .filter((line) => line.includes("│") && !line.includes("─"))
        .map(splitBoxTableRow)
        .filter((row) => row.length > 0);
      if (tableRows.length > 0) {
        blocks.push(<Table headers={tableRows[0]} rows={tableRows.slice(1)} key={`table-${blocks.length}`} />);
      }
    } else if (i + 1 < lines.length && isTableSeparator(lines[i + 1]) && lines[i].includes("|")) {
      flushPlain();
      const headers = splitTableRow(lines[i]);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      i--;
      blocks.push(<Table headers={headers} rows={rows} key={`table-${blocks.length}`} />);
    } else {
      plainLines.push(lines[i]);
    }
  }
  flushPlain();

  return (
    <div className="markdown">
      {blocks}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <table className="markdown-table">
      <thead>
        <tr>{headers.map((cell, j) => <th key={j}>{renderInlineMarkdown(cell)}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, j) => (
          <tr key={j}>
            {headers.map((_, k) => <td key={k}>{renderInlineMarkdown(row[k] ?? "")}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function isBoxTableBorder(line: string): boolean {
  return /[┌├└┐┤┘┬┴┼]/.test(line) && line.includes("─");
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function splitBoxTableRow(line: string): string[] {
  return line.split("│").slice(1, -1).map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(!?)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\bhttps?:\/\/[^\s<]+|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    if (match[1] === "!") {
      nodes.push(value);
    } else if (match[2] && match[3]) {
      nodes.push(<a key={`${start}-link`} href={match[3]} target="_blank" rel="noreferrer">{match[2]}</a>);
    } else if (value.startsWith("http")) {
      const href = value.replace(/[.,;:!?]+$/, "");
      nodes.push(<a key={`${start}-url`} href={href} target="_blank" rel="noreferrer">{value}</a>);
    } else if (value.startsWith("`")) {
      nodes.push(<code key={`${start}-code`}>{value.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${start}-strong`}>{value.slice(2, -2)}</strong>);
    }
    last = start + value.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Header({ stats, view, onViewChange }: { stats: Stats | null; view: View; onViewChange: (view: View) => void }) {
  return (
    <header className="header">
      <span className="wordmark">
        backstory<span className="dot">.</span>
      </span>
      <nav className="tabs" aria-label="Backstory views">
        <button className={view === "prompts" ? "active" : ""} onClick={() => onViewChange("prompts")}>Prompts</button>
        <button className={view === "observability" ? "active" : ""} onClick={() => onViewChange("observability")}>Observability</button>
      </nav>
      {stats && (
        <div className="stats">
          <span>
            <b>{stats.sessions}</b> sessions
          </span>
          <span>
            <b>{stats.prompts}</b> prompts
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
        <span className="field repo"><span className="field-label">repo</span><span className="field-value">{s.repo ?? "no-repo"}</span></span>
        <span className="field branch"><span className="field-label">branch</span><span className="field-value">{s.branch ?? "no-branch"}</span></span>
        <span className="field count"><span className="field-label">prompts</span><span className="field-value">{s.promptCount}</span></span>
      </div>
    </div>
  );
}

function CommitList({ commits }: { commits: LinkedCommit[] }) {
  if (commits.length === 0) return null;
  return (
    <div className="prompt-commits">
      <div className="prompt-commit-label">commits from this prompt</div>
      {commits.map((commit) => (
        <a
          className="commit"
          key={commit.sha}
          href={commit.repo ? `https://github.com/${commit.repo}/commit/${commit.sha}` : undefined}
          target="_blank"
          rel="noreferrer"
        >
          <span className="commit-sha">{commit.sha.slice(0, 10)}</span>
          <span className="commit-subject">{commit.subject || "(no subject)"}</span>
          <Badge kind={commit.source === "hook" ? "exact" : "corr"}>{commit.source === "hook" ? "exact" : "correlated"}</Badge>
        </a>
      ))}
    </div>
  );
}

/** Attribute each commit to the latest prompt before it was authored. */
function commitsForPrompt(prompts: SessionWithPrompts["prompts"], index: number, commits: LinkedCommit[]): LinkedCommit[] {
  return commits.filter((commit) => {
    const commitAt = commit.authoredAt ? Date.parse(commit.authoredAt) : Number.NaN;
    if (!Number.isFinite(commitAt)) return index === prompts.length - 1;
    let owner = 0;
    for (let i = 0; i < prompts.length; i++) {
      const promptAt = prompts[i].ts ? Date.parse(prompts[i].ts!) : Number.NaN;
      if (Number.isFinite(promptAt) && promptAt <= commitAt) owner = i;
    }
    return owner === index;
  });
}

function Detail({ session, commits }: { session: SessionWithPrompts | null; commits: LinkedCommit[] }) {
  if (!session) return <div className="empty">Select a session to see its prompts →</div>;
  return (
    <div>
      <div className="detail-heading">
        <h1>{session.title || session.id}</h1>
      </div>
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
      {session.prompts.map((p, index) => (
        <div className="prompt" key={p.seq}>
          <div className="num">#{p.seq}{p.ts ? ` · ${fmtDate(p.ts)}` : ""}</div>
          <Markdown text={p.text} />
          <CommitList commits={commitsForPrompt(session.prompts, index, commits)} />
        </div>
      ))}
    </div>
  );
}

function ActivityChart({ points, providers }: { points: ActivityPoint[]; providers: string[] }) {
  const width = 1000;
  const height = 285;
  const pad = { top: 22, right: 24, bottom: 38, left: 46 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.prompts));
  const x = (index: number) => pad.left + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth);
  const y = (value: number) => pad.top + chartHeight - (value / max) * chartHeight;
  const path = (provider: string) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.byProvider[provider] ?? 0).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const dateTicks = points.length > 0 ? [0, Math.floor((points.length - 1) / 4), Math.floor((points.length - 1) / 2), Math.floor((points.length - 1) * 0.75), points.length - 1] : [];

  return (
    <div className="activity-chart-wrap">
      {points.length === 0 ? <div className="empty-chart">No activity in this period.</div> : (
        <svg className="activity-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Prompt activity over time">
          {ticks.map((tick) => <g key={tick}><line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={y(max * tick)} y2={y(max * tick)} /><text className="chart-axis-label" x={pad.left - 10} y={y(max * tick) + 4} textAnchor="end">{Math.round(max * tick)}</text></g>)}
          {providers.map((provider) => <path key={provider} className={`activity-line ${provider}`} d={path(provider)} />)}
          {points.map((p, i) => providers.map((provider) => {
            const prompts = p.byProvider[provider] ?? 0;
            if (prompts === 0) return null;
            return <g key={`${p.day}-${provider}`}>
              <g className="chart-node">
                <circle className="activity-hit" cx={x(i)} cy={y(prompts)} r="10">
                  <title>{`${p.day} · ${provider}: ${prompts} prompts · ${p.sessions} sessions · ${p.commits} commits`}</title>
                </circle>
                <foreignObject className="chart-tooltip-foreign" x={Math.min(x(i) + 10, width - 194)} y={Math.max(y(prompts) - 78, pad.top)} width="180" height="70">
                  <div className={`chart-tooltip-svg ${provider}`}>
                    <div className="chart-tooltip-date">{p.day}</div>
                    <div className={`chart-tooltip-provider ${provider}`}><i />{provider}</div>
                    <div className="chart-tooltip-stats"><b>{prompts}</b> prompts <b>{p.sessions}</b> sessions <b>{p.commits}</b> commits</div>
                  </div>
                </foreignObject>
              </g>
              <circle className={`activity-point ${provider}`} cx={x(i)} cy={y(prompts)} r="4" />
            </g>;
          }))}
          {dateTicks.map((index) => <text key={index} className="chart-date-label" x={x(index)} y={height - 10} textAnchor="middle">{points[index]?.day.slice(5)}</text>)}
        </svg>
      )}
    </div>
  );
}

type View = "prompts" | "observability";
type SessionSort = "last-message" | "prompts" | "alphabetical";

function Observability({ points }: { points: ActivityPoint[] }) {
  const totalPrompts = points.reduce((n, p) => n + p.prompts, 0);
  const totalSessions = points.reduce((n, p) => n + p.sessions, 0);
  const totalCommits = points.reduce((n, p) => n + p.commits, 0);
  const providers = [...new Set(points.flatMap((p) => Object.keys(p.byProvider)))];
  return (
    <main className="observability">
      <div className="observe-heading">
        <div>
          <div className="eyebrow">Activity over time</div>
          <h1>Prompt observability</h1>
          <p>See how your coding conversations, sessions, and commits move together.</p>
        </div>
        <div className="observe-window">last 90 days</div>
      </div>
      <div className="observe-cards">
        <div><span>prompts</span><b>{totalPrompts}</b></div>
        <div><span>sessions</span><b>{totalSessions}</b></div>
        <div><span>commits</span><b>{totalCommits}</b></div>
        <div><span>active days</span><b>{points.length}</b></div>
      </div>
      <section className="activity-panel">
        <div className="panel-heading"><span>Prompt activity</span><span className="legend">{providers.map((p) => <span key={p}><i className={`legend-dot ${p}`} />{p}</span>)}</span></div>
        <ActivityChart points={points} providers={providers} />
      </section>
      <section className="activity-panel activity-table-panel">
        <div className="panel-heading"><span>Recent activity</span><span className="faint">prompts · sessions · commits</span></div>
        {[...points].reverse().slice(0, 12).map((p) => <div className="activity-row" key={p.day}><span>{p.day}</span><b>{p.prompts}</b><b>{p.sessions}</b><b>{p.commits}</b></div>)}
      </section>
    </main>
  );
}

export function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [query, setQuery] = useState("");
  const [sessionSort, setSessionSort] = useState<SessionSort>("last-message");
  const [sortOpen, setSortOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionWithPrompts | null>(null);
  const [commits, setCommits] = useState<LinkedCommit[]>([]);
  const [timeline, setTimeline] = useState<ActivityPoint[]>([]);
  const [view, setView] = useState<View>("prompts");
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.sessions().then(setSessions).catch(() => {});
    api.timeline().then(setTimeline).catch(() => {});
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
      setCommits([]);
      return;
    }
    setDetail(null);
    setCommits([]);
    api.session(selectedId)
      .then((session) => {
        setDetail(session);
        return api.sessionCommits(selectedId).catch(() => [] as LinkedCommit[]);
      })
      .then(setCommits)
      .catch(() => setDetail(null));
  }, [selectedId]);

  const searching = hits !== null;
  const grouped = useMemo(() => {
    const lastMessage = (session: SessionListItem) => session.endedAt ?? session.startedAt ?? "";
    return [...sessions].sort((a, b) => {
      if (sessionSort === "prompts") return b.promptCount - a.promptCount || lastMessage(b).localeCompare(lastMessage(a));
      if (sessionSort === "alphabetical") return (a.title || a.id).localeCompare(b.title || b.id) || lastMessage(b).localeCompare(lastMessage(a));
      return lastMessage(b).localeCompare(lastMessage(a));
    });
  }, [sessions, sessionSort]);

  return (
    <div className="app">
      <Header stats={stats} view={view} onViewChange={setView} />
      {view === "observability" ? <Observability points={timeline} /> : <div className="main">
        <aside className="sidebar">
          <div className="searchbar">
            <input
              placeholder="search prompts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
            <div className="sort-control">
              <button
                className={`sort-trigger ${sortOpen ? "active" : ""}`}
                aria-label="Sort sessions"
                aria-expanded={sortOpen}
                onClick={() => setSortOpen((open) => !open)}
              >
                ↕
              </button>
              {sortOpen && <div className="sort-menu" role="menu" aria-label="Sort sessions by">
                {([
                  ["last-message", "Last message"],
                  ["prompts", "Most prompts"],
                  ["alphabetical", "Alphabetical"],
                ] as Array<[SessionSort, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    role="menuitemradio"
                    aria-checked={sessionSort === value}
                    className={sessionSort === value ? "selected" : ""}
                    onClick={() => { setSessionSort(value); setSortOpen(false); }}
                  >
                    <span>{label}</span>
                    {sessionSort === value && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>}
            </div>
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
            {searching && hits!.length === 0 && (
              <div className="search-empty">
                <div className="search-empty-icon">⌕</div>
                <div className="search-empty-title">No prompts found</div>
                <div className="search-empty-detail">
                  Nothing matched <span>“{query.trim()}”</span>
                </div>
                <button className="clear-search" onClick={() => setQuery("")}>Clear search</button>
              </div>
            )}
          </div>
        </aside>
        <section className="detail">
          <Detail session={detail} commits={commits} />
        </section>
      </div>}
    </div>
  );
}

/** FTS returns snippets wrapped in [ ] around matches; render those as <mark>. */
function escapeSnippet(s: string): string {
  const esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\[([^\]]*)\]/g, "<mark>$1</mark>");
}
