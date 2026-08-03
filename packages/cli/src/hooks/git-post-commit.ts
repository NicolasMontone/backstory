import type { Database } from "bun:sqlite";
import { $ } from "bun";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { linkCommitSession, upsertCommit } from "../db.ts";
import { normalizeRepo, remoteUrl, repoRoot, resolveSha, showCommit } from "../git.ts";
import type { HookInstallResult, HookProvider, HookStatus } from "./types.ts";

const MARKER = "# >>> backstory post-commit >>>";
const END = "# <<< backstory post-commit <<<";

/** Where this repo keeps its hooks (respects core.hooksPath). */
async function hooksDir(dir: string): Promise<string | null> {
  const root = await repoRoot(dir);
  if (!root) return null;
  try {
    const custom = (await $`git -C ${dir} config core.hooksPath`.quiet().text()).trim();
    if (custom) return custom.startsWith("/") ? custom : join(root, custom);
  } catch {
    /* not set */
  }
  return join(root, ".git", "hooks");
}

/** Install (idempotently) a post-commit hook that stamps the active session. */
export async function installHook(dir: string): Promise<{ path: string; created: boolean }> {
  const hd = await hooksDir(dir);
  if (!hd) throw new Error("not inside a git repository");
  mkdirSync(hd, { recursive: true });
  const path = join(hd, "post-commit");

  // The hook shells out to `bs`; fall back to this exact runner if bs isn't on PATH.
  const runner = process.execPath.endsWith("bun") ? `bun ${join(import.meta.dir, "..", "index.ts")}` : `bs`;
  const block = [
    MARKER,
    `if command -v bs >/dev/null 2>&1; then bs hook record >/dev/null 2>&1 || true;`,
    `else ${runner} hook record >/dev/null 2>&1 || true; fi`,
    END,
  ].join("\n");

  let created = false;
  let content = "";
  if (existsSync(path)) {
    content = readFileSync(path, "utf8");
    if (content.includes(MARKER)) {
      content = content.replace(new RegExp(`${MARKER}[\\s\\S]*?${END}`), block);
    } else {
      content = content.replace(/\s*$/, "\n") + "\n" + block + "\n";
    }
  } else {
    content = `#!/bin/sh\n${block}\n`;
    created = true;
  }
  writeFileSync(path, content);
  chmodSync(path, 0o755);
  return { path, created };
}

/**
 * Called by the git post-commit hook. Finds the agent session active in this
 * repo right now and records an exact commit→session link.
 */
export async function recordHook(
  db: Database,
  dir: string,
  findActiveSession: (repoRootDir: string, withinMs: number) => { id: string } | null,
): Promise<{ sha: string; sessionId: string } | null> {
  const root = (await repoRoot(dir)) ?? dir;
  const sha = await resolveSha(dir, "HEAD");
  if (!sha) return null;
  const meta = await showCommit(dir, sha);
  const origin = await remoteUrl(root);
  const session = findActiveSession(root, 60 * 60_000); // active within the last hour
  const sessionMeta = session
    ? (db.query(`SELECT repo FROM sessions WHERE id = ?`).get(session.id) as { repo: string | null } | null)
    : null;
  upsertCommit(db, {
    sha,
    repo: normalizeRepo(origin) ?? sessionMeta?.repo ?? null,
    authoredAt: meta?.authoredAt ?? null,
    author: meta?.author ?? null,
    subject: meta?.subject ?? null,
  });
  if (!session) return null;
  linkCommitSession(db, sha, session.id, "hook");
  return { sha, sessionId: session.id };
}

/** Git `post-commit` hook — agent-agnostic exact linking for any commit. */
export class GitPostCommitHookProvider implements HookProvider {
  readonly name = "git-post-commit";
  readonly description = "git post-commit hook that stamps the active session onto each new commit";

  async isSupported(dir: string): Promise<boolean> {
    return (await repoRoot(dir)) !== null;
  }

  async status(dir: string): Promise<HookStatus> {
    const hd = await hooksDir(dir);
    if (!hd) return { provider: this.name, supported: false, installed: false, detail: "not a git repository" };
    const path = join(hd, "post-commit");
    const installed = existsSync(path) && readFileSync(path, "utf8").includes(MARKER);
    return { provider: this.name, supported: true, installed, detail: path };
  }

  async install(dir: string): Promise<HookInstallResult> {
    const { path, created } = await installHook(dir);
    return { provider: this.name, installed: true, detail: `${created ? "installed" : "updated"} ${path}` };
  }
}

export const gitPostCommitHook = new GitPostCommitHookProvider();
