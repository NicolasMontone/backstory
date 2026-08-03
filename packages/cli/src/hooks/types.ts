/** The result of checking a hook in a given directory. */
export interface HookStatus {
  provider: string;
  /** Applicable here (e.g. inside a git repo, agent installed)? */
  supported: boolean;
  /** Already installed here? */
  installed: boolean;
  /** Human detail — a path, a reason it's unsupported, etc. */
  detail: string | null;
}

/** The result of installing a hook. */
export interface HookInstallResult {
  provider: string;
  installed: boolean;
  detail: string;
}

/**
 * A pluggable way to capture *exact* prompt→commit links as work happens,
 * rather than inferring them after the fact by correlation.
 *
 * The built-in one is a git `post-commit` hook (agent-agnostic). Future ones
 * could use an agent's own hook system — e.g. a Claude Code hook, or Codex's
 * `notify` — to record the producing session with no time-window guessing.
 *
 * To add one: implement this interface and register it in `hooks/index.ts`.
 */
export interface HookProvider {
  readonly name: string;
  readonly description: string;
  /** Is this hook meaningful in `dir` (git repo present, agent installed…)? */
  isSupported(dir: string): Promise<boolean>;
  /** Report whether it's supported and currently installed in `dir`. */
  status(dir: string): Promise<HookStatus>;
  /** Install (idempotently) in `dir`. */
  install(dir: string): Promise<HookInstallResult>;
}
