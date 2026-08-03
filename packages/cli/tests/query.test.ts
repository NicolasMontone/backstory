import { describe, expect, test } from "bun:test";
import { openDb, linkCommitSession, replacePrompts, upsertCommit, upsertSessions } from "../src/db.ts";
import {
  activeSession,
  commitsForSession,
  searchPrompts,
  sessionById,
  sessionsForBranch,
  sessionsForCommit,
  sessionsForShas,
  stats,
} from "../src/query.ts";
import type { Database } from "bun:sqlite";
import type { SessionRecord } from "../src/providers/types.ts";

function seed(): Database {
  const db = openDb(":memory:");
  const base: Omit<SessionRecord, "id" | "branch" | "provider" | "endedAt"> = {
    cwd: "/w/app",
    repo: "acme/app",
    repositoryUrl: "git@github.com:acme/app.git",
    startCommit: null,
    startedAt: "2026-01-01T00:00:00Z",
    title: null,
    sourcePath: "/p",
  };
  upsertSessions(db, [
    { ...base, id: "s1", provider: "codex", branch: "feature/x", endedAt: "2026-01-01T01:00:00Z", title: "Add feature x" },
    { ...base, id: "s2", provider: "claude", branch: "main", endedAt: "2026-01-02T01:00:00Z", title: "Main work" },
  ]);
  replacePrompts(db, [
    { sessionId: "s1", seq: 0, text: "add the widget", ts: "2026-01-01T00:10:00Z" },
    { sessionId: "s1", seq: 1, text: "make the widget draggable", ts: "2026-01-01T00:20:00Z" },
    { sessionId: "s2", seq: 0, text: "refactor the parser", ts: "2026-01-02T00:10:00Z" },
  ]);
  upsertCommit(db, { sha: "c1", repo: "acme/app", authoredAt: "2026-01-01T00:30:00Z", author: "Me", subject: "widget" });
  linkCommitSession(db, "c1", "s1", "correlated");
  return db;
}

describe("query", () => {
  test("sessionsForCommit returns linked sessions with prompts + source", () => {
    const db = seed();
    const res = sessionsForCommit(db, "c1");
    expect(res.length).toBe(1);
    expect(res[0].id).toBe("s1");
    expect(res[0].source).toBe("correlated");
    expect(res[0].prompts.map((p) => p.text)).toEqual(["add the widget", "make the widget draggable"]);
  });

  test("sessionsForBranch filters by branch and repo", () => {
    const db = seed();
    expect(sessionsForBranch(db, "feature/x").map((s) => s.id)).toEqual(["s1"]);
    expect(sessionsForBranch(db, "main", "acme/app").map((s) => s.id)).toEqual(["s2"]);
    expect(sessionsForBranch(db, "main", "other/repo")).toEqual([]);
  });

  test("sessionsForShas unions across commits", () => {
    const db = seed();
    linkCommitSession(db, "c1", "s2", "hook");
    expect(sessionsForShas(db, ["c1"]).map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(sessionsForShas(db, [])).toEqual([]);
  });

  test("sessionById returns full prompts or null", () => {
    const db = seed();
    expect(sessionById(db, "s1")?.prompts.length).toBe(2);
    expect(sessionById(db, "nope")).toBeNull();
  });

  test("commitsForSession returns linked commit metadata", () => {
    const db = seed();
    expect(commitsForSession(db, "s1")).toEqual([
      { sha: "c1", repo: "acme/app", subject: "widget", author: "Me", authoredAt: "2026-01-01T00:30:00Z", source: "correlated" },
    ]);
    expect(commitsForSession(db, "nope")).toEqual([]);
  });

  test("searchPrompts matches FTS terms", () => {
    const db = seed();
    expect(searchPrompts(db, "widget").length).toBe(2);
    expect(searchPrompts(db, "parser").length).toBe(1);
    expect(searchPrompts(db, "nonexistentterm").length).toBe(0);
  });

  test("activeSession respects the recency window", () => {
    const db = openDb(":memory:");
    const now = Date.now();
    const recent = new Date(now - 60_000).toISOString();
    const old = new Date(now - 10 * 60_000).toISOString();
    upsertSessions(db, [
      { id: "r", provider: "codex", cwd: "/w/app", repo: null, repositoryUrl: null, branch: null, startCommit: null, startedAt: recent, endedAt: recent, title: null, sourcePath: "/p" },
    ]);
    expect(activeSession(db, "/w/app", 5 * 60_000)?.id).toBe("r");
    expect(activeSession(db, "/w/app", 30_000)).toBeNull(); // too old for window
    expect(activeSession(db, "/other", 5 * 60_000)).toBeNull(); // wrong dir
    // cwd nested under repo root also matches
    upsertSessions(db, [
      { id: "nested", provider: "codex", cwd: "/w/app/sub", repo: null, repositoryUrl: null, branch: null, startCommit: null, startedAt: recent, endedAt: recent, title: null, sourcePath: "/p" },
    ]);
    expect(activeSession(db, "/w/app", 5 * 60_000)).not.toBeNull();
    void old;
  });

  test("stats aggregates by provider and repo", () => {
    const db = seed();
    const s = stats(db);
    expect(s.sessions).toBe(2);
    expect(s.prompts).toBe(3);
    expect(s.links).toBe(1);
    expect(s.linksCorrelated).toBe(1);
    expect(s.byProvider.find((p) => p.provider === "codex")?.prompts).toBe(2);
    expect(s.byRepo[0]).toEqual({ repo: "acme/app", sessions: 2 });
  });
});
