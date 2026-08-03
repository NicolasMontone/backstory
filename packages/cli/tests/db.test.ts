import { describe, expect, test } from "bun:test";
import {
  lastIngestedAt,
  linkCommitSession,
  openDb,
  replacePrompts,
  upsertCommit,
  upsertSessions,
} from "../src/db.ts";
import type { SessionRecord } from "../src/providers/types.ts";

function session(id: string, over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    provider: "codex",
    cwd: "/w",
    repo: "acme/app",
    repositoryUrl: "git@github.com:acme/app.git",
    branch: "main",
    startCommit: null,
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T01:00:00Z",
    title: "t",
    sourcePath: "/p",
    ...over,
  };
}

describe("db", () => {
  test("upsertSessions inserts and updates", () => {
    const db = openDb(":memory:");
    upsertSessions(db, [session("a", { title: "one" })]);
    upsertSessions(db, [session("a", { title: "two" })]);
    const row = db.query(`SELECT title FROM sessions WHERE id='a'`).get() as { title: string };
    expect(row.title).toBe("two");
    expect((db.query(`SELECT COUNT(*) n FROM sessions`).get() as any).n).toBe(1);
  });

  test("replacePrompts renumbers seq across multi-file sessions", () => {
    const db = openDb(":memory:");
    upsertSessions(db, [session("a")]);
    // Two 'files' for the same session id, each starting at seq 0.
    replacePrompts(db, [
      { sessionId: "a", seq: 0, text: "second", ts: "2026-01-01T00:10:00Z" },
      { sessionId: "a", seq: 0, text: "first", ts: "2026-01-01T00:05:00Z" },
    ]);
    const rows = db.query(`SELECT seq, text FROM prompts WHERE session_id='a' ORDER BY seq`).all() as any[];
    expect(rows).toEqual([
      { seq: 0, text: "first" },
      { seq: 1, text: "second" },
    ]);
  });

  test("replacePrompts is idempotent (cleanly replaces)", () => {
    const db = openDb(":memory:");
    upsertSessions(db, [session("a")]);
    const p = [{ sessionId: "a", seq: 0, text: "x", ts: null }];
    replacePrompts(db, p);
    replacePrompts(db, p);
    expect((db.query(`SELECT COUNT(*) n FROM prompts`).get() as any).n).toBe(1);
    expect((db.query(`SELECT COUNT(*) n FROM prompts_fts`).get() as any).n).toBe(1);
  });

  test("linkCommitSession does not downgrade hook → correlated", () => {
    const db = openDb(":memory:");
    upsertSessions(db, [session("a")]);
    upsertCommit(db, { sha: "sha1", repo: "acme/app", authoredAt: null, author: null, subject: "s" });
    linkCommitSession(db, "sha1", "a", "hook");
    linkCommitSession(db, "sha1", "a", "correlated"); // must NOT override
    const row = db.query(`SELECT source FROM commit_sessions WHERE sha='sha1' AND session_id='a'`).get() as any;
    expect(row.source).toBe("hook");
  });

  test("lastIngestedAt returns max ended_at", () => {
    const db = openDb(":memory:");
    expect(lastIngestedAt(db)).toBeNull();
    upsertSessions(db, [session("a", { endedAt: "2026-01-01T00:00:00Z" }), session("b", { endedAt: "2026-05-01T00:00:00Z" })]);
    expect(lastIngestedAt(db)).toBe("2026-05-01T00:00:00Z");
  });
});
