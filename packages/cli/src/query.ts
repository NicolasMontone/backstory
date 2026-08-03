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

export function sessionsForCommit(db: Database, sha: string): SessionWithPrompts[] {
  const rows = db
    .query(`SELECT session_id AS id, source FROM commit_sessions WHERE sha = ? ORDER BY source DESC`)
    .all(sha) as Array<{ id: string; source: string }>;
  return hydrate(db, rows);
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
