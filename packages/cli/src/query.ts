import type { Database } from "bun:sqlite";

export interface PromptRow {
  seq: number;
  text: string;
  ts: string | null;
}

export interface SessionWithPrompts {
  id: string;
  provider: string;
  title: string | null;
  repo: string | null;
  branch: string | null;
  cwd: string;
  startedAt: string;
  endedAt: string;
  source: string | null; // how it linked to the queried commit(s): hook | correlated
  prompts: PromptRow[];
}

export interface CommitInfo {
  sha: string;
  repo: string | null;
  subject: string | null;
  author: string | null;
  authoredAt: string | null;
}

function promptsFor(db: Database, sessionId: string): PromptRow[] {
  return db
    .query(`SELECT seq, text, ts FROM prompts WHERE session_id = ? ORDER BY seq`)
    .all(sessionId) as PromptRow[];
}

function hydrate(db: Database, rows: Array<{ id: string; source?: string | null }>): SessionWithPrompts[] {
  const get = db.query(
    `SELECT id, provider, title, repo, branch, cwd, started_at, ended_at FROM sessions WHERE id = ?`,
  );
  const out: SessionWithPrompts[] = [];
  for (const r of rows) {
    const s = get.get(r.id) as any;
    if (!s) continue;
    out.push({
      id: s.id,
      provider: s.provider,
      title: s.title,
      repo: s.repo,
      branch: s.branch,
      cwd: s.cwd,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      source: r.source ?? null,
      prompts: promptsFor(db, s.id),
    });
  }
  return out;
}

export function commitInfo(db: Database, sha: string): CommitInfo | null {
  const c = db.query(`SELECT sha, repo, subject, author, authored_at FROM commits WHERE sha = ?`).get(sha) as any;
  if (!c) return null;
  return { sha: c.sha, repo: c.repo, subject: c.subject, author: c.author, authoredAt: c.authored_at };
}

export function sessionById(db: Database, id: string): SessionWithPrompts | null {
  const [s] = hydrate(db, [{ id }]);
  return s ?? null;
}

export function sessionsForCommit(db: Database, sha: string): SessionWithPrompts[] {
  const rows = db
    .query(`SELECT session_id AS id, source FROM commit_sessions WHERE sha = ? ORDER BY source DESC`)
    .all(sha) as Array<{ id: string; source: string }>;
  return hydrate(db, rows);
}

export interface LinkedCommit {
  sha: string;
  repo: string | null;
  subject: string | null;
  author: string | null;
  authoredAt: string | null;
  source: string; // hook | correlated
}

/** Commits linked to a session (the reverse of sessionsForCommit). */
export function commitsForSession(db: Database, sessionId: string): LinkedCommit[] {
  return db
    .query(
      `SELECT c.sha, c.repo, c.subject, c.author, c.authored_at AS authoredAt, cs.source
       FROM commit_sessions cs JOIN commits c ON c.sha = cs.sha
       WHERE cs.session_id = ?
       ORDER BY c.authored_at DESC`,
    )
    .all(sessionId) as LinkedCommit[];
}

export function sessionsForBranch(db: Database, branch: string, repo?: string): SessionWithPrompts[] {
  const rows = (
    repo
      ? db.query(`SELECT id FROM sessions WHERE branch = ? AND repo = ? ORDER BY started_at`).all(branch, repo)
      : db.query(`SELECT id FROM sessions WHERE branch = ? ORDER BY started_at`).all(branch)
  ) as Array<{ id: string }>;
  return hydrate(db, rows);
}

export function sessionsForShas(db: Database, shas: string[]): SessionWithPrompts[] {
  if (shas.length === 0) return [];
  const placeholders = shas.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT session_id AS id, MAX(source) AS source FROM commit_sessions
       WHERE sha IN (${placeholders}) GROUP BY session_id`,
    )
    .all(...shas) as Array<{ id: string; source: string }>;
  return hydrate(db, rows);
}

export interface SessionListItem {
  id: string;
  provider: string;
  title: string | null;
  repo: string | null;
  branch: string | null;
  startedAt: string;
  promptCount: number;
}

export function listSessions(db: Database, opts: { limit?: number; repo?: string } = {}): SessionListItem[] {
  const limit = opts.limit ?? 30;
  const where = opts.repo ? `WHERE s.repo = ?` : ``;
  const params = opts.repo ? [opts.repo, limit] : [limit];
  return db
    .query(
      `SELECT s.id, s.provider, s.title, s.repo, s.branch, s.started_at AS startedAt,
              (SELECT COUNT(*) FROM prompts p WHERE p.session_id = s.id) AS promptCount
       FROM sessions s ${where}
       ORDER BY s.ended_at DESC LIMIT ?`,
    )
    .all(...params) as SessionListItem[];
}

export interface Stats {
  sessions: number;
  prompts: number;
  commits: number;
  links: number;
  linksExact: number;
  linksCorrelated: number;
  byProvider: Array<{ provider: string; sessions: number; prompts: number }>;
  byRepo: Array<{ repo: string; sessions: number }>;
}

export interface ActivityPoint {
  day: string;
  prompts: number;
  sessions: number;
  commits: number;
  byProvider: Record<string, number>;
}

export function activityTimeline(db: Database, days = 90): ActivityPoint[] {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const points = new Map<string, ActivityPoint>();
  const point = (day: string): ActivityPoint => {
    const existing = points.get(day);
    if (existing) return existing;
    const created = { day, prompts: 0, sessions: 0, commits: 0, byProvider: {} };
    points.set(day, created);
    return created;
  };

  const prompts = db
    .query(
      `SELECT substr(p.ts, 1, 10) day, s.provider, COUNT(*) count
       FROM prompts p JOIN sessions s ON s.id = p.session_id
       WHERE p.ts IS NOT NULL AND p.ts >= ?
       GROUP BY day, s.provider`,
    )
    .all(since) as Array<{ day: string; provider: string; count: number }>;
  for (const row of prompts) {
    const p = point(row.day);
    p.prompts += row.count;
    p.byProvider[row.provider] = (p.byProvider[row.provider] ?? 0) + row.count;
  }

  const sessions = db
    .query(`SELECT substr(started_at, 1, 10) day, COUNT(*) count FROM sessions WHERE started_at >= ? GROUP BY day`)
    .all(since) as Array<{ day: string; count: number }>;
  for (const row of sessions) point(row.day).sessions = row.count;

  const commits = db
    .query(`SELECT substr(authored_at, 1, 10) day, COUNT(*) count FROM commits WHERE authored_at >= ? GROUP BY day`)
    .all(since) as Array<{ day: string; count: number }>;
  for (const row of commits) point(row.day).commits = row.count;

  return [...points.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function stats(db: Database): Stats {
  const one = (sql: string): number => (db.query(sql).get() as { n: number } | null)?.n ?? 0;
  return {
    sessions: one(`SELECT COUNT(*) n FROM sessions`),
    prompts: one(`SELECT COUNT(*) n FROM prompts`),
    commits: one(`SELECT COUNT(*) n FROM commits`),
    links: one(`SELECT COUNT(*) n FROM commit_sessions`),
    linksExact: one(`SELECT COUNT(*) n FROM commit_sessions WHERE source='hook'`),
    linksCorrelated: one(`SELECT COUNT(*) n FROM commit_sessions WHERE source='correlated'`),
    byProvider: db
      .query(
        `SELECT s.provider, COUNT(DISTINCT s.id) sessions, COUNT(p.seq) prompts
         FROM sessions s LEFT JOIN prompts p ON p.session_id = s.id
         GROUP BY s.provider ORDER BY sessions DESC`,
      )
      .all() as Stats["byProvider"],
    byRepo: db
      .query(
        `SELECT COALESCE(repo,'(no repo)') repo, COUNT(*) sessions
         FROM sessions GROUP BY repo ORDER BY sessions DESC LIMIT 15`,
      )
      .all() as Stats["byRepo"],
  };
}

export interface SearchHit {
  sessionId: string;
  seq: number;
  text: string;
  title: string | null;
  repo: string | null;
}

/** Most recent session running inside `repoRoot`, active within `withinMs`. */
export function activeSession(db: Database, repoRoot: string, withinMs: number): { id: string } | null {
  const rows = db
    .query(
      `SELECT id, ended_at FROM sessions
       WHERE cwd = ? OR cwd LIKE ? || '/%'
       ORDER BY ended_at DESC LIMIT 1`,
    )
    .all(repoRoot, repoRoot) as Array<{ id: string; ended_at: string }>;
  const r = rows[0];
  if (!r) return null;
  const age = Date.now() - Date.parse(r.ended_at);
  if (Number.isFinite(age) && age > withinMs) return null;
  return { id: r.id };
}

export function searchPrompts(db: Database, term: string, limit = 25): SearchHit[] {
  return db
    .query(
      `SELECT f.session_id AS sessionId, f.seq AS seq,
              snippet(prompts_fts, 0, '[', ']', ' … ', 12) AS text,
              s.title AS title, s.repo AS repo
       FROM prompts_fts f JOIN sessions s ON s.id = f.session_id
       WHERE prompts_fts MATCH ? ORDER BY rank LIMIT ?`,
    )
    .all(term, limit) as SearchHit[];
}
