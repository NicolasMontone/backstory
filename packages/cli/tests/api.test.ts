import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { Backstory } from "../src/api.ts";
import { commit, jsonl, makeRepo, rm, tmp, write } from "./helpers.ts";

let repo: string;
let codexHome: string;
let claudeHome: string;
let sha: string;
const prevCodex = process.env.CODEX_HOME;
const prevClaude = process.env.CLAUDE_CONFIG_DIR;

beforeAll(async () => {
  repo = await makeRepo({ email: "me@example.com", name: "Me", remote: "git@github.com:acme/app.git" });
  sha = await commit(repo, { date: "2026-04-01T12:05:00Z", email: "me@example.com", name: "Me", msg: "build it" });

  // Codex fixture
  codexHome = tmp("bs-codex-");
  write(
    join(codexHome, "sessions", "2026", "04", "01", "rollout-2026-04-01T12-00-00-x.jsonl"),
    jsonl(
      {
        type: "session_meta",
        payload: {
          session_id: "codex-1",
          cwd: repo,
          timestamp: "2026-04-01T12:00:00Z",
          git: { commit_hash: "0", branch: "main", repository_url: "git@github.com:acme/app.git" },
        },
      },
      { timestamp: "2026-04-01T12:01:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "build the export button" }] } },
    ),
  );

  // Claude fixture
  claudeHome = tmp("bs-claude-");
  write(
    join(claudeHome, "projects", "-work-app", "claude-1.jsonl"),
    jsonl({
      type: "user",
      sessionId: "claude-1",
      cwd: repo,
      gitBranch: "main",
      timestamp: "2026-04-01T12:02:00Z",
      promptSource: "typed",
      message: { role: "user", content: "and wire it to the API" },
    }),
  );

  process.env.CODEX_HOME = codexHome;
  process.env.CLAUDE_CONFIG_DIR = claudeHome;
});

afterAll(() => {
  process.env.CODEX_HOME = prevCodex;
  process.env.CLAUDE_CONFIG_DIR = prevClaude;
  [repo, codexHome, claudeHome].forEach(rm);
});

describe("Backstory API (integration)", () => {
  test("ingest both providers and correlate to a commit", async () => {
    using bs = Backstory.open(":memory:");
    const summary = await bs.ingest({ full: true, authorEmails: ["me@example.com"] });

    expect(summary.providers.find((p) => p.provider === "codex")).toMatchObject({ available: true, sessions: 1, prompts: 1 });
    expect(summary.providers.find((p) => p.provider === "claude")).toMatchObject({ available: true, sessions: 1, prompts: 1 });
    expect(summary.totals).toEqual({ sessions: 2, prompts: 2 });
    expect(summary.correlate.linked).toBeGreaterThanOrEqual(1);

    // commit → the sessions that produced it
    const report = bs.commitReport(sha);
    const ids = report.sessions.map((s) => s.id).sort();
    expect(ids).toContain("codex-1");

    // stats reflect both providers
    const st = bs.stats();
    expect(st.sessions).toBe(2);
    expect(st.byProvider.map((p) => p.provider).sort()).toEqual(["claude", "codex"]);

    // search across providers
    expect(bs.search("export").map((h) => h.sessionId)).toContain("codex-1");
    expect(bs.search("API").length).toBeGreaterThanOrEqual(1);

    // branch report
    expect(bs.branchReport("main", "acme/app").sessions.length).toBeGreaterThanOrEqual(1);

    // session detail
    expect(bs.session("codex-1")?.prompts[0].text).toBe("build the export button");
    expect(bs.session("missing")).toBeNull();
  });
});
