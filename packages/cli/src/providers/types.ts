// Provider-agnostic model. A "session" is one continuous conversation with an
// AI coding agent; a "prompt" is a single user turn within it. Providers
// (Codex today, Claude Code next) know how to read their own on-disk logs and
// normalize them into these shapes.

export interface SessionRecord {
  /** Stable id from the provider (e.g. Codex session_id / rollout uuid). */
  id: string;
  /** Which agent produced this session. */
  provider: string;
  /** Working directory the session ran in. */
  cwd: string;
  /** Normalized "owner/repo" if a git repo was detected, else null. */
  repo: string | null;
  /** Raw remote URL (e.g. git@github.com:vercel/v0.git), if known. */
  repositoryUrl: string | null;
  /** Branch at session start, if known. */
  branch: string | null;
  /** HEAD commit at session start, if known. */
  startCommit: string | null;
  /** ISO timestamp of first activity. */
  startedAt: string;
  /** ISO timestamp of last activity. */
  endedAt: string;
  /** Human-friendly title/summary if the provider generated one. */
  title: string | null;
  /** Absolute path to the source log file, for provenance/debugging. */
  sourcePath: string;
}

export interface PromptRecord {
  sessionId: string;
  /** 0-based order of this prompt within its session. */
  seq: number;
  /** The user's prompt text (injected context already stripped). */
  text: string;
  /** ISO timestamp of the prompt, if known. */
  ts: string | null;
}

export interface IngestResult {
  sessions: SessionRecord[];
  prompts: PromptRecord[];
}

export interface Provider {
  name: string;
  /** True if this provider's data appears to exist on this machine. */
  isAvailable(): boolean;
  /**
   * Scan the provider's logs and yield normalized records.
   * `since` (ISO) lets callers do incremental ingests by skipping older files.
   */
  ingest(opts: { since?: string }): Promise<IngestResult>;
}
