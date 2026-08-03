import { Database } from "bun:sqlite";
import { openDb, lastIngestedAt, replacePrompts, upsertSessions } from "./db.ts";
import { correlate } from "./correlate.ts";
import { sessionProviders } from "./providers/index.ts";
import { fetchPr, ghReady, type PrInfo } from "./github.ts";
import { hookProviders, recordHook, type HookInstallResult, type HookProvider, type HookStatus } from "./hooks/index.ts";
import {
  activeSession,
  commitInfo,
  commitsForSession,
  listSessions,
  searchPrompts,
  sessionById,
  sessionsForBranch,
  sessionsForCommit,
  sessionsForShas,
  stats,
  type CommitInfo,
  type LinkedCommit,
  type SearchHit,
  type SessionListItem,
  type SessionWithPrompts,
  type Stats,
} from "./query.ts";

export interface IngestSummary {
  providers: Array<{ provider: string; available: boolean; sessions: number; prompts: number }>;
  correlate: { linked: number; commitsSeen: number };
  totals: { sessions: number; prompts: number };
}

export interface CommitReport {
  sha: string;
  commit: CommitInfo | null;
  sessions: SessionWithPrompts[];
}

export interface BranchReport {
  branch: string;
  repo: string | null;
  sessions: SessionWithPrompts[];
}

export interface PrReport {
  pr: PrInfo;
  sessions: SessionWithPrompts[];
}

/**
 * The backstory core. Wraps the on-disk SQLite index and exposes every query as
 * a typed method. Safe to import from other apps (e.g. a web viewer):
 *
 *   import { Backstory } from "@backstory/cli";
 *   using bs = Backstory.open();
 *   const report = bs.commitReport(sha);
 */
export class Backstory {
  private constructor(private readonly db: Database) {}

  static open(path?: string): Backstory {
    return new Backstory(openDb(path));
  }

  /** Wrap an existing Database (used by tests and the git hook). */
  static fromDb(db: Database): Backstory {
    return new Backstory(db);
  }

  get database(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }

  /** Dispose support: `using bs = Backstory.open()`. */
  [Symbol.dispose](): void {
    this.close();
  }

  /** Parse all available providers into the index, then correlate with git. */
  async ingest(
    opts: { full?: boolean; since?: string; authorEmails?: string[]; skipCorrelate?: boolean } = {},
  ): Promise<IngestSummary> {
    const since = opts.since ?? (opts.full ? undefined : lastIngestedAt(this.db) ?? undefined);
    const providers: IngestSummary["providers"] = [];
    let totalS = 0;
    let totalP = 0;
    for (const provider of sessionProviders()) {
      if (!provider.isAvailable()) {
        providers.push({ provider: provider.name, available: false, sessions: 0, prompts: 0 });
        continue;
      }
      const { sessions, prompts } = await provider.ingest({ since });
      upsertSessions(this.db, sessions);
      replacePrompts(this.db, prompts);
      providers.push({ provider: provider.name, available: true, sessions: sessions.length, prompts: prompts.length });
      totalS += sessions.length;
      totalP += prompts.length;
    }
    const cor = opts.skipCorrelate
      ? { linked: 0, commitsSeen: 0 }
      : await correlate(this.db, { authorEmails: opts.authorEmails });
    return { providers, correlate: cor, totals: { sessions: totalS, prompts: totalP } };
  }

  /** Re-run only the git correlation pass (no re-parse). */
  correlate(opts: { authorEmails?: string[]; graceMinutes?: number } = {}) {
    return correlate(this.db, opts);
  }

  commitReport(sha: string): CommitReport {
    return { sha, commit: commitInfo(this.db, sha), sessions: sessionsForCommit(this.db, sha) };
  }

  branchReport(branch: string, repo?: string): BranchReport {
    return { branch, repo: repo ?? null, sessions: sessionsForBranch(this.db, branch, repo) };
  }

  async prReport(num: number, opts: { dir?: string; repo?: string } = {}): Promise<PrReport | null> {
    if (!(await ghReady())) throw new Error("gh CLI not available/authenticated. Run `gh auth login`.");
    const pr = await fetchPr(num, opts);
    if (!pr) return null;
    const byCommit = sessionsForShas(this.db, pr.commits);
    const byBranch = sessionsForBranch(this.db, pr.headRefName, pr.repo || undefined);
    const merged = new Map<string, SessionWithPrompts>();
    for (const s of [...byCommit, ...byBranch]) if (!merged.has(s.id)) merged.set(s.id, s);
    return { pr, sessions: [...merged.values()] };
  }

  sessions(opts: { limit?: number; repo?: string } = {}): SessionListItem[] {
    return listSessions(this.db, opts);
  }

  session(id: string): SessionWithPrompts | null {
    return sessionById(this.db, id);
  }

  /** Commits linked to a session (reverse of commitReport). */
  sessionCommits(id: string): LinkedCommit[] {
    return commitsForSession(this.db, id);
  }

  search(term: string, limit?: number): SearchHit[] {
    return searchPrompts(this.db, term, limit);
  }

  stats(): Stats {
    return stats(this.db);
  }

  /** The registered hook providers (git post-commit, and any future ones). */
  hookProviders(): HookProvider[] {
    return hookProviders();
  }

  /** Status of every hook provider in `dir`. */
  async hookStatus(dir: string): Promise<HookStatus[]> {
    return Promise.all(hookProviders().map((h) => h.status(dir)));
  }

  /** Install every supported hook provider in `dir`. */
  async installHooks(dir: string): Promise<HookInstallResult[]> {
    const results: HookInstallResult[] = [];
    for (const h of hookProviders()) {
      if (await h.isSupported(dir)) results.push(await h.install(dir));
    }
    return results;
  }

  /** Record an exact commit→session link (called by the git hook). */
  recordHook(dir: string) {
    return recordHook(this.db, dir, (root, withinMs) => activeSession(this.db, root, withinMs));
  }
}

export type {
  CommitInfo,
  PrInfo,
  SearchHit,
  SessionListItem,
  SessionWithPrompts,
  LinkedCommit,
  Stats,
  HookProvider,
  HookStatus,
  HookInstallResult,
};
export type { SessionRecord, PromptRecord, Provider } from "./providers/types.ts";
