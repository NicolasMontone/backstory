import type { Database } from "bun:sqlite";
import { $ } from "bun";
import { linkCommitSession, upsertCommit } from "./db.ts";
import { gitIdentity, logCommits, repoRoot } from "./git.ts";

interface SessionRow {
  id: string;
  cwd: string;
  repo: string | null;
  branch: string | null;
  started_at: string;
  ended_at: string;
}

/** SHAs reachable from a ref (branch), or null if the ref no longer exists. */
async function shasOnRef(dir: string, ref: string): Promise<Set<string> | null> {
  try {
    const out = await $`git -C ${dir} log ${ref} --pretty=%H`.quiet().text();
    return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/**
 * Fuzzy-link commits to sessions by repo + branch + time window.
 *
 * A commit is attributed to a session when it lives on the session's branch and
 * was authored between the session start and its end (plus a grace period, since
 * people often commit shortly after the agent finishes a turn). Hook-stamped
 * links already in the DB are never downgraded.
 */
export async function correlate(
  db: Database,
  opts: { graceMinutes?: number; authorEmails?: string[] } = {},
): Promise<{ linked: number; commitsSeen: number }> {
  const graceMs = (opts.graceMinutes ?? 15) * 60_000;
  // Only your own commits count. Other people's commits merged into a shared
  // branch during a session window are noise. Empty set = accept any author.
  const allowEmails = new Set((opts.authorEmails ?? []).map((e) => e.toLowerCase()).filter(Boolean));

  const sessions = db
    .query(`SELECT id, cwd, repo, branch, started_at, ended_at FROM sessions WHERE repo IS NOT NULL AND cwd <> ''`)
    .all() as SessionRow[];

  // Group sessions by working directory so we scan each repo's git log once.
  const byCwd = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const arr = byCwd.get(s.cwd) ?? [];
    arr.push(s);
    byCwd.set(s.cwd, arr);
  }

  let linked = 0;
  let commitsSeen = 0;

  for (const [cwd, group] of byCwd) {
    const root = (await repoRoot(cwd)) ?? cwd;
    // Build the per-repo allowed-author set: explicit override, else this repo's
    // configured git identity. If we can't determine one, accept any author.
    const emails = new Set(allowEmails);
    if (emails.size === 0) {
      const id = await gitIdentity(root);
      if (id.email) emails.add(id.email.toLowerCase());
    }
    const authorOk = (email: string) => emails.size === 0 || emails.has((email ?? "").toLowerCase());

    const commits = await logCommits(root);
    if (commits.length === 0) continue;
    commitsSeen += commits.length;

    const repo = group.find((g) => g.repo)?.repo ?? null;
    for (const c of commits) {
      upsertCommit(db, { sha: c.sha, repo, authoredAt: c.authoredAt, author: c.author, subject: c.subject });
    }

    // Cache branch membership lookups within this repo.
    const refCache = new Map<string, Set<string> | null>();
    const getRef = async (ref: string) => {
      if (!refCache.has(ref)) refCache.set(ref, await shasOnRef(root, ref));
      return refCache.get(ref)!;
    };

    for (const s of group) {
      const start = ms(s.started_at);
      const end = ms(s.ended_at) + graceMs;
      if (Number.isNaN(start)) continue;

      const onBranch = s.branch ? await getRef(s.branch) : null;
      for (const c of commits) {
        if (!authorOk(c.authorEmail)) continue;
        const at = ms(c.authoredAt);
        if (Number.isNaN(at) || at < start || at > end) continue;
        // If the branch still exists, require membership; otherwise fall back to
        // time-window-only within the same repo.
        if (onBranch && !onBranch.has(c.sha)) continue;
        linkCommitSession(db, c.sha, s.id, "correlated");
        linked++;
      }
    }
  }

  return { linked, commitsSeen };
}
