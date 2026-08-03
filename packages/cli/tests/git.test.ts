import { describe, expect, test, afterAll } from "bun:test";
import { gitIdentity, logCommits, normalizeRepo, remoteUrl, resolveSha, showCommit } from "../src/git.ts";
import { commit, makeRepo, rm } from "./helpers.ts";

describe("normalizeRepo", () => {
  test.each([
    ["git@github.com:vercel/v0.git", "vercel/v0"],
    ["git@github.com:vercel/v0", "vercel/v0"],
    ["https://github.com/vercel/v0.git", "vercel/v0"],
    ["https://github.com/vercel/v0", "vercel/v0"],
    ["ssh://git@github.com/owner/repo.git", "owner/repo"],
    ["https://gitlab.com/group/sub/repo.git", "group/sub/repo"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeRepo(input)).toBe(expected);
  });

  test("returns null for empty/garbage", () => {
    expect(normalizeRepo(null)).toBeNull();
    expect(normalizeRepo("")).toBeNull();
    expect(normalizeRepo("not-a-url")).toBeNull();
  });
});

describe("git helpers against a real repo", () => {
  const repos: string[] = [];
  afterAll(() => repos.forEach(rm));

  test("logCommits, showCommit, gitIdentity, resolveSha, remoteUrl", async () => {
    const dir = await makeRepo({ email: "me@example.com", name: "Me", remote: "git@github.com:acme/app.git" });
    repos.push(dir);
    const sha1 = await commit(dir, { date: "2026-01-01T10:00:00Z", email: "me@example.com", name: "Me", msg: "first" });
    const sha2 = await commit(dir, { date: "2026-01-02T10:00:00Z", email: "other@x.com", name: "Other", msg: "second" });

    const commits = await logCommits(dir);
    expect(commits.length).toBe(2);
    expect(commits[0].sha).toBe(sha2); // newest first
    expect(commits[0].authorEmail).toBe("other@x.com");
    expect(commits[1].authorEmail).toBe("me@example.com");

    const one = await showCommit(dir, sha1);
    expect(one?.subject).toBe("first");
    expect(one?.authorEmail).toBe("me@example.com");

    const id = await gitIdentity(dir);
    expect(id.email).toBe("me@example.com");

    expect(await resolveSha(dir, "HEAD")).toBe(sha2);
    expect(normalizeRepo(await remoteUrl(dir))).toBe("acme/app");
  });

  test("helpers fail soft outside a repo", async () => {
    expect(await logCommits("/nonexistent-xyz")).toEqual([]);
    expect(await resolveSha("/nonexistent-xyz", "HEAD")).toBeNull();
    expect(await remoteUrl("/nonexistent-xyz")).toBeNull();
  });
});
