import { describe, expect, test, afterAll } from "bun:test";
import { isInjectedContext, parseCodexFile } from "../src/providers/codex.ts";
import { jsonl, rm, tmp, write } from "./helpers.ts";
import { join } from "node:path";

describe("isInjectedContext", () => {
  test("drops injected blocks, keeps real prompts", () => {
    expect(isInjectedContext("<app-context>\n...")).toBe(true);
    expect(isInjectedContext("# AGENTS.md instructions for x")).toBe(true);
    expect(isInjectedContext("# Codex desktop context")).toBe(true);
    expect(isInjectedContext("fix the login bug")).toBe(false);
    expect(isInjectedContext("  can you refactor this?")).toBe(false);
  });
});

describe("parseCodexFile", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach(rm));

  test("extracts meta, git block, and real user prompts", async () => {
    const dir = tmp();
    dirs.push(dir);
    const file = join(dir, "rollout-2026-08-03T11-18-41-abc.jsonl");
    write(
      file,
      jsonl(
        {
          timestamp: "2026-08-03T14:18:42Z",
          type: "session_meta",
          payload: {
            session_id: "sess-1",
            cwd: "/work/app",
            timestamp: "2026-08-03T14:18:41Z",
            git: { commit_hash: "deadbeef", branch: "feature/x", repository_url: "git@github.com:acme/app.git" },
          },
        },
        { timestamp: "2026-08-03T14:19:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<app-context>\nignore me" }] } },
        { timestamp: "2026-08-03T14:19:05Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "add a dark mode toggle" }] } },
        { timestamp: "2026-08-03T14:19:10Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "sure" }] } },
        { timestamp: "2026-08-03T14:20:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "now make it persist" }] } },
      ),
    );

    const parsed = await parseCodexFile(file);
    expect(parsed).not.toBeNull();
    const { session, prompts } = parsed!;
    expect(session.id).toBe("sess-1");
    expect(session.provider).toBe("codex");
    expect(session.cwd).toBe("/work/app");
    expect(session.branch).toBe("feature/x");
    expect(session.startCommit).toBe("deadbeef");
    expect(session.repo).toBe("acme/app");
    expect(session.endedAt).toBe("2026-08-03T14:20:00Z");

    expect(prompts.map((p) => p.text)).toEqual(["add a dark mode toggle", "now make it persist"]);
    expect(prompts.map((p) => p.seq)).toEqual([0, 1]);
  });

  test("returns null when there is no session_meta", async () => {
    const dir = tmp();
    dirs.push(dir);
    const file = join(dir, "rollout-x.jsonl");
    write(file, jsonl({ payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] } }));
    expect(await parseCodexFile(file)).toBeNull();
  });
});
