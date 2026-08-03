import { describe, expect, test, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { gitPostCommitHook, installHook, recordHook } from "../src/hooks/git-post-commit.ts";
import { openDb, upsertSessions } from "../src/db.ts";
import { commit, makeRepo, rm } from "./helpers.ts";

const repos: string[] = [];
afterAll(() => repos.forEach(rm));

describe("installHook", () => {
  test("creates an executable post-commit hook and is idempotent", async () => {
    const dir = await makeRepo();
    repos.push(dir);
    const first = await installHook(dir);
    expect(first.created).toBe(true);
    const path = join(dir, ".git", "hooks", "post-commit");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("backstory post-commit");
    expect(content).toContain("hook record");

    // Re-install: still exactly one backstory block, marked as updated.
    const second = await installHook(dir);
    expect(second.created).toBe(false);
    const after = readFileSync(path, "utf8");
    expect(after.match(/>>> backstory/g)?.length).toBe(1);
  });

  test("preserves an existing user hook", async () => {
    const dir = await makeRepo();
    repos.push(dir);
    const path = join(dir, ".git", "hooks", "post-commit");
    Bun.write(path, "#!/bin/sh\necho existing\n");
    await installHook(dir);
    const content = readFileSync(path, "utf8");
    expect(content).toContain("echo existing");
    expect(content).toContain("backstory post-commit");
  });
});

describe("recordHook", () => {
  test("records an exact link for the active session", async () => {
    const dir = await makeRepo({ email: "me@example.com", name: "Me" });
    repos.push(dir);
    const sha = await commit(dir, { date: "2026-01-01T00:00:00Z", email: "me@example.com", name: "Me", msg: "c" });

    const db = openDb(":memory:");
    upsertSessions(db, [
      { id: "active", provider: "codex", cwd: dir, repo: "acme/app", repositoryUrl: null, branch: "main", startCommit: null, startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:00Z", title: null, sourcePath: "/p" },
    ]);

    const res = await recordHook(db, dir, () => ({ id: "active" }));
    expect(res).toEqual({ sha, sessionId: "active" });
    const row = db.query(`SELECT source FROM commit_sessions WHERE sha=? AND session_id='active'`).get(sha) as any;
    expect(row.source).toBe("hook");
  });

  test("no-op when there is no active session", async () => {
    const dir = await makeRepo({ email: "me@example.com", name: "Me" });
    repos.push(dir);
    await commit(dir, { date: "2026-01-01T00:00:00Z", email: "me@example.com", name: "Me", msg: "c" });
    const db = openDb(":memory:");
    const res = await recordHook(db, dir, () => null);
    expect(res).toBeNull();
    expect((db.query(`SELECT COUNT(*) n FROM commit_sessions`).get() as any).n).toBe(0);
  });
});

describe("GitPostCommitHookProvider (HookProvider interface)", () => {
  test("isSupported / status / install", async () => {
    const dir = await makeRepo();
    repos.push(dir);
    expect(await gitPostCommitHook.isSupported(dir)).toBe(true);

    const before = await gitPostCommitHook.status(dir);
    expect(before).toMatchObject({ provider: "git-post-commit", supported: true, installed: false });

    const res = await gitPostCommitHook.install(dir);
    expect(res.installed).toBe(true);

    const after = await gitPostCommitHook.status(dir);
    expect(after.installed).toBe(true);
  });

  test("unsupported outside a git repo", async () => {
    expect(await gitPostCommitHook.isSupported("/nonexistent-xyz")).toBe(false);
    const st = await gitPostCommitHook.status("/nonexistent-xyz");
    expect(st).toMatchObject({ supported: false, installed: false });
  });
});
