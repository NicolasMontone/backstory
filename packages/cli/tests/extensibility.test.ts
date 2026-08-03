import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { JsonlSessionProvider } from "../src/providers/base.ts";
import { registerSessionProvider, sessionProvider, sessionProviders } from "../src/providers/registry.ts";
import { registerHookProvider, hookProvider, hookProviders } from "../src/hooks/registry.ts";
import type { ParsedSession } from "../src/providers/types.ts";
import type { HookProvider } from "../src/hooks/types.ts";
import { jsonl, rm, tmp, write } from "./helpers.ts";

// A minimal third-party agent provider, to prove the extension surface is small.
class FakeAgentProvider extends JsonlSessionProvider {
  readonly name = "fake-agent";
  constructor(private root: string) {
    super();
  }
  protected rootDir() {
    return this.root;
  }
  protected async parseFile(path: string): Promise<ParsedSession | null> {
    const o = JSON.parse((await Bun.file(path).text()).trim());
    return {
      session: {
        id: o.id,
        provider: this.name,
        cwd: o.cwd,
        repo: null,
        repositoryUrl: null,
        branch: o.branch ?? null,
        startCommit: null,
        startedAt: o.ts,
        endedAt: o.ts,
        title: o.title ?? null,
        sourcePath: path,
      },
      prompts: [{ sessionId: o.id, seq: 0, text: o.prompt, ts: o.ts }],
    };
  }
}

describe("session provider extensibility", () => {
  test("a custom JsonlSessionProvider walks, parses, and honors `since`", async () => {
    const dir = tmp("bs-fake-");
    write(join(dir, "a", "s1.jsonl"), jsonl({ id: "s1", cwd: "/w", ts: "2026-01-01T00:00:00Z", prompt: "hello" }));
    write(join(dir, "b", "s2.jsonl"), jsonl({ id: "s2", cwd: "/w", ts: "2026-06-01T00:00:00Z", prompt: "later" }));
    const provider = new FakeAgentProvider(dir);

    expect(provider.isAvailable()).toBe(true);
    const all = await provider.ingest({});
    expect(all.sessions.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(all.prompts.length).toBe(2);

    // `since` drops the older session by its endedAt.
    const recent = await provider.ingest({ since: "2026-03-01T00:00:00Z" });
    expect(recent.sessions.map((s) => s.id)).toEqual(["s2"]);

    rm(dir);
  });

  test("unavailable when the root dir is missing", () => {
    expect(new FakeAgentProvider("/nonexistent-xyz").isAvailable()).toBe(false);
  });

  test("registry registers and looks up by name", () => {
    const p = new FakeAgentProvider(tmp("bs-reg-"));
    registerSessionProvider(p);
    expect(sessionProvider("fake-agent")).toBe(p);
    expect(sessionProviders().some((x) => x.name === "fake-agent")).toBe(true);
  });
});

describe("hook provider extensibility", () => {
  test("registry registers and looks up custom hook providers", () => {
    const fake: HookProvider = {
      name: "fake-hook",
      description: "test",
      async isSupported() {
        return true;
      },
      async status(dir) {
        return { provider: "fake-hook", supported: true, installed: false, detail: dir };
      },
      async install() {
        return { provider: "fake-hook", installed: true, detail: "ok" };
      },
    };
    registerHookProvider(fake);
    expect(hookProvider("fake-hook")).toBe(fake);
    expect(hookProviders().some((h) => h.name === "fake-hook")).toBe(true);
  });
});
