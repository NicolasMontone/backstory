import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PromptRecord, SessionRecord } from "./providers/types.ts";

export const BACKSTORY_HOME = process.env.BACKSTORY_HOME || join(homedir(), ".backstory");
export const DB_PATH = process.env.BACKSTORY_DB || join(BACKSTORY_HOME, "backstory.db");

export function openDb(path: string = DB_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      provider       TEXT NOT NULL,
      cwd            TEXT NOT NULL,
      repo           TEXT,
      repository_url TEXT,
      branch         TEXT,
      start_commit   TEXT,
      started_at     TEXT NOT NULL,
      ended_at       TEXT NOT NULL,
      title          TEXT,
      source_path    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      session_id TEXT NOT NULL,
      seq        INTEGER NOT NULL,
      text       TEXT NOT NULL,
      ts         TEXT,
      PRIMARY KEY (session_id, seq),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS commits (
      sha         TEXT PRIMARY KEY,
      repo        TEXT,
      authored_at TEXT,
      author      TEXT,
      subject     TEXT
    );

    -- Many-to-many: a commit may be linked to sessions exactly (hook) or fuzzily
    -- (correlated by repo + branch + time window).
    CREATE TABLE IF NOT EXISTS commit_sessions (
      sha        TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source     TEXT NOT NULL CHECK (source IN ('hook','correlated')),
      PRIMARY KEY (sha, session_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_repo_branch ON sessions(repo, branch);
    CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(started_at, ended_at);
    CREATE INDEX IF NOT EXISTS idx_commit_sessions_session ON commit_sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_commits_repo ON commits(repo);

    CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts USING fts5(
      text, session_id UNINDEXED, seq UNINDEXED
    );
  `);
}

export function upsertSessions(db: Database, sessions: SessionRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, provider, cwd, repo, repository_url, branch, start_commit, started_at, ended_at, title, source_path)
    VALUES ($id, $provider, $cwd, $repo, $repository_url, $branch, $start_commit, $started_at, $ended_at, $title, $source_path)
    ON CONFLICT(id) DO UPDATE SET
      cwd=excluded.cwd, repo=excluded.repo, repository_url=excluded.repository_url,
      branch=excluded.branch, start_commit=excluded.start_commit,
      started_at=excluded.started_at, ended_at=excluded.ended_at,
      title=excluded.title, source_path=excluded.source_path
  `);
  const tx = db.transaction((rows: SessionRecord[]) => {
    for (const s of rows) {
      stmt.run({
        $id: s.id,
        $provider: s.provider,
        $cwd: s.cwd,
        $repo: s.repo,
        $repository_url: s.repositoryUrl,
        $branch: s.branch,
        $start_commit: s.startCommit,
        $started_at: s.startedAt,
        $ended_at: s.endedAt,
        $title: s.title,
        $source_path: s.sourcePath,
      });
    }
  });
  tx(sessions);
}

export function replacePrompts(db: Database, prompts: PromptRecord[]): void {
  // Group by session so re-ingesting a session cleanly replaces its prompts.
  const bySession = new Map<string, PromptRecord[]>();
  for (const p of prompts) {
    const arr = bySession.get(p.sessionId) ?? [];
    arr.push(p);
    bySession.set(p.sessionId, arr);
  }
  const del = db.prepare(`DELETE FROM prompts WHERE session_id = ?`);
  const delFts = db.prepare(`DELETE FROM prompts_fts WHERE session_id = ?`);
  const ins = db.prepare(`INSERT INTO prompts (session_id, seq, text, ts) VALUES (?, ?, ?, ?)`);
  const insFts = db.prepare(`INSERT INTO prompts_fts (text, session_id, seq) VALUES (?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const [sid, rows] of bySession) {
      del.run(sid);
      delFts.run(sid);
      // A single session_id can span multiple rollout files (resumes/forks), each
      // with its own 0-based seq. Renumber sequentially, ordered by timestamp, so
      // seq is unique and monotonic within the session.
      rows.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? "") || a.seq - b.seq);
      let i = 0;
      for (const p of rows) {
        ins.run(sid, i, p.text, p.ts);
        insFts.run(p.text, sid, i);
        i++;
      }
    }
  });
  tx();
}

export function upsertCommit(
  db: Database,
  c: { sha: string; repo: string | null; authoredAt: string | null; author: string | null; subject: string | null },
): void {
  db.prepare(`
    INSERT INTO commits (sha, repo, authored_at, author, subject)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sha) DO UPDATE SET
      repo=excluded.repo, authored_at=excluded.authored_at,
      author=excluded.author, subject=excluded.subject
  `).run(c.sha, c.repo, c.authoredAt, c.author, c.subject);
}

export function linkCommitSession(db: Database, sha: string, sessionId: string, source: "hook" | "correlated"): void {
  // Hook links are authoritative and must not be downgraded by a later correlation pass.
  db.prepare(`
    INSERT INTO commit_sessions (sha, session_id, source)
    VALUES (?, ?, ?)
    ON CONFLICT(sha, session_id) DO UPDATE SET
      source = CASE WHEN commit_sessions.source = 'hook' THEN 'hook' ELSE excluded.source END
  `).run(sha, sessionId, source);
}

/** Latest ended_at across sessions, for incremental ingest. */
export function lastIngestedAt(db: Database): string | null {
  const row = db.query(`SELECT MAX(ended_at) AS m FROM sessions`).get() as { m: string | null } | null;
  return row?.m ?? null;
}
