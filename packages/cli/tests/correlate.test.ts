import { describe, expect, test, afterAll } from "bun:test";
import { correlate } from "../src/correlate.ts";
import { openDb, upsertSessions } from "../src/db.ts";
import { commit, makeRepo, rm } from "./helpers.ts";
import type { Database } from "bun:sqlite";

const repos: string[] = [];
afterAll(() => repos.forEach(rm));

function linkedShas(db: Database): string[] {
  return (db.query(`SELECT sha FROM commit_sessions ORDER BY sha`).all() as { sha: string }[]).map((r) => r.sha);
}

describe("correlate", () => {
  test("links only the user's own commits within the session window & branch", async () => {
    const dir = await makeRepo({ email: "me@example.com", name: "Me", remote: "git@github.com:acme/app.git" });
    repos.push(dir);
    const mine = await commit(dir, { date: "2026-01-01T00:30:00Z", email: "me@example.com", name: "Me", msg: "mine-in" });
    const theirs = await commit(dir, { date: "2026-01-01T00:40:00Z", email: "other@x.com", name: "Other", msg: "theirs-in" });
    const mineOut = await commit(dir, { date: "2026-02-01T00:00:00Z", email: "me@example.com", name: "Me", msg: "mine-out" });

    const db = openDb(":memory:");
    upsertSessions(db, [
      {
        id: "s1",
        provider: "codex",
        cwd: dir,
        repo: "acme/app",
        repositoryUrl: "git@github.com:acme/app.git",
        branch: "main",
        startCommit: null,
        startedAt: "2026-01-01T00:00:00Z",
        endedAt: "2026-01-01T01:00:00Z",
        title: null,
        sourcePath: "/p",
      },
    ]);

    const res = await correlate(db, { authorEmails: ["me@example.com"] });
    expect(res.linked).toBe(1);
    expect(linkedShas(db)).toEqual([mine]);
    // sanity: the excluded ones really weren't linked
    expect(linkedShas(db)).not.toContain(theirs);
    expect(linkedShas(db)).not.toContain(mineOut);
  });

  test("falls back to repo git identity when no authorEmails given", async () => {
    const dir = await makeRepo({ email: "solo@example.com", name: "Solo", remote: "git@github.com:acme/solo.git" });
    repos.push(dir);
    const c = await commit(dir, { date: "2026-03-01T12:00:00Z", email: "solo@example.com", name: "Solo", msg: "c" });

    const db = openDb(":memory:");
    upsertSessions(db, [
      {
        id: "s1",
        provider: "codex",
        cwd: dir,
        repo: "acme/solo",
        repositoryUrl: null,
        branch: "main",
        startCommit: null,
        startedAt: "2026-03-01T11:50:00Z",
        endedAt: "2026-03-01T12:10:00Z",
        title: null,
        sourcePath: "/p",
      },
    ]);

    await correlate(db); // no authorEmails → uses `git config user.email`
    expect(linkedShas(db)).toEqual([c]);
  });
});
