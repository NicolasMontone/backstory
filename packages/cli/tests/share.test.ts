import { describe, expect, test } from "bun:test";
import type { PrReport } from "../src/api.ts";
import { buildSharePayload, createShareLink, promptCount, shareEndpoint } from "../src/share.ts";

const report: PrReport = {
  pr: {
    number: 42,
    title: "Add export button",
    headRefName: "feature/export",
    baseRefName: "main",
    url: "https://github.com/acme/app/pull/42",
    repo: "acme/app",
    commits: ["abc123", "def456"],
  },
  sessions: [
    {
      id: "sess-1",
      provider: "claude",
      title: "export work",
      repo: "acme/app",
      branch: "feature/export",
      cwd: "/Users/nico/dev/secret-path/app", // must NOT leak into the payload
      startedAt: "2026-04-01T12:00:00Z",
      endedAt: "2026-04-01T12:30:00Z",
      source: "hook",
      prompts: [
        { seq: 0, text: "build the export button", ts: "2026-04-01T12:01:00Z" },
        { seq: 1, text: "wire it to the API", ts: "2026-04-01T12:05:00Z" },
      ],
    },
  ],
};

describe("buildSharePayload", () => {
  test("produces a versioned snapshot with only public fields", () => {
    const payload = buildSharePayload(report);
    expect(payload.version).toBe(1);
    expect(payload.pr).toEqual({
      number: 42,
      title: "Add export button",
      url: "https://github.com/acme/app/pull/42",
      repo: "acme/app",
      headRefName: "feature/export",
      baseRefName: "main",
    });
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions[0].prompts.map((p) => p.text)).toEqual([
      "build the export button",
      "wire it to the API",
    ]);
    expect(promptCount(payload)).toBe(2);
  });

  test("does not leak local-only fields (cwd, repo, endedAt)", () => {
    const serialized = JSON.stringify(buildSharePayload(report));
    expect(serialized).not.toContain("secret-path");
    expect(serialized).not.toContain("cwd");
    expect(serialized).not.toContain("endedAt");
  });
});

describe("shareEndpoint", () => {
  test("explicit wins over env and default, trailing slash stripped", () => {
    expect(shareEndpoint("https://share.example.com/")).toBe("https://share.example.com");
  });

  test("falls back to BACKSTORY_SHARE_URL, then throws when unconfigured", () => {
    const prev = process.env.BACKSTORY_SHARE_URL;
    process.env.BACKSTORY_SHARE_URL = "https://env.example.com";
    expect(shareEndpoint()).toBe("https://env.example.com");
    delete process.env.BACKSTORY_SHARE_URL;
    // No silent localhost default: a published CLI must not quietly POST prompts.
    expect(() => shareEndpoint()).toThrow(/no share endpoint configured/);
    if (prev !== undefined) process.env.BACKSTORY_SHARE_URL = prev;
  });
});

describe("createShareLink", () => {
  test("POSTs the payload and returns the service link", async () => {
    let seenUrl = "";
    let seenBody = "";
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seenUrl = String(url);
      seenBody = String(init?.body);
      return new Response(JSON.stringify({ id: "abcd", url: "https://share.example.com/s/abcd" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const link = await createShareLink(buildSharePayload(report), {
      endpoint: "https://share.example.com",
      fetch: fakeFetch,
    });

    expect(seenUrl).toBe("https://share.example.com/api/links");
    expect(JSON.parse(seenBody).pr.number).toBe(42);
    expect(link).toEqual({ id: "abcd", url: "https://share.example.com/s/abcd" });
  });

  test("builds the URL from the endpoint when the service returns only an id", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ id: "xyz" }), { status: 200 })) as unknown as typeof fetch;
    const link = await createShareLink(buildSharePayload(report), {
      endpoint: "https://share.example.com/",
      fetch: fakeFetch,
    });
    expect(link.url).toBe("https://share.example.com/s/xyz");
  });

  test("surfaces a service error body", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: "payload too large" }), { status: 413 })) as unknown as typeof fetch;
    await expect(
      createShareLink(buildSharePayload(report), { endpoint: "https://share.example.com", fetch: fakeFetch }),
    ).rejects.toThrow("payload too large");
  });
});
