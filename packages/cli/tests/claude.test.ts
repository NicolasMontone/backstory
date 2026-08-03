import { describe, expect, test, afterAll } from "bun:test";
import { parseClaudeFile } from "../src/providers/claude.ts";
import { jsonl, rm, tmp, write } from "./helpers.ts";
import { join } from "node:path";

describe("parseClaudeFile", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach(rm));

  test("keeps only human prompts (typed/queued), cleans image markers", async () => {
    const dir = tmp();
    dirs.push(dir);
    const file = join(dir, "abc-123.jsonl");
    write(
      file,
      jsonl(
        { type: "user", sessionId: "s1", cwd: "/work/app", gitBranch: "main", timestamp: "2026-07-01T10:00:00Z", promptSource: "typed", message: { role: "user", content: "first prompt" } },
        // tool_result masquerading as a user turn (promptSource null) → dropped
        { type: "user", sessionId: "s1", timestamp: "2026-07-01T10:00:05Z", message: { role: "user", content: [{ type: "tool_result", content: "x" }] } },
        // sidechain (subagent) → dropped
        { type: "user", sessionId: "s1", isSidechain: true, timestamp: "2026-07-01T10:00:06Z", promptSource: "typed", message: { role: "user", content: "subagent noise" } },
        // interrupt marker → dropped
        { type: "user", sessionId: "s1", timestamp: "2026-07-01T10:00:07Z", promptSource: "typed", message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
        // command wrapper → dropped
        { type: "user", sessionId: "s1", timestamp: "2026-07-01T10:00:08Z", promptSource: "typed", message: { role: "user", content: "<command-message>/foo</command-message>" } },
        // image-prefixed real prompt → kept, prefix stripped
        { type: "user", sessionId: "s1", gitBranch: "feature/y", timestamp: "2026-07-01T10:01:00Z", promptSource: "typed", message: { role: "user", content: [{ type: "text", text: "[Image #1] why is this red?" }, { type: "image", source: {} }] } },
        // queued human prompt → kept
        { type: "user", sessionId: "s1", timestamp: "2026-07-01T10:02:00Z", promptSource: "queued", message: { role: "user", content: "and fix the padding" } },
        { type: "ai-title", aiTitle: "Fix styling", timestamp: "2026-07-01T10:03:00Z" },
      ),
    );

    const parsed = await parseClaudeFile(file);
    expect(parsed).not.toBeNull();
    const { session, prompts } = parsed!;
    expect(session.id).toBe("s1");
    expect(session.provider).toBe("claude");
    expect(session.cwd).toBe("/work/app");
    expect(session.branch).toBe("feature/y"); // last-seen branch wins
    expect(session.title).toBe("Fix styling");
    expect(session.startCommit).toBeNull();
    expect(prompts.map((p) => p.text)).toEqual(["first prompt", "why is this red?", "and fix the padding"]);
    expect(prompts.map((p) => p.seq)).toEqual([0, 1, 2]);
  });

  test("includes sdk prompts (Claude Code via the SDK/harness)", async () => {
    const dir = tmp();
    dirs.push(dir);
    const file = join(dir, "sdk.jsonl");
    write(
      file,
      jsonl(
        { type: "user", sessionId: "s2", cwd: "/w", gitBranch: "main", timestamp: "2026-07-01T10:00:00Z", promptSource: "sdk", message: { role: "user", content: "build the thing" } },
        // system-source prompt is still excluded
        { type: "user", sessionId: "s2", timestamp: "2026-07-01T10:00:01Z", promptSource: "system", message: { role: "user", content: "injected system note" } },
      ),
    );
    const parsed = await parseClaudeFile(file);
    expect(parsed!.prompts.map((p) => p.text)).toEqual(["build the thing"]);
  });
});
