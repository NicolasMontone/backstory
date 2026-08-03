import { $ } from "bun";

/** Normalize a git remote URL to "owner/repo", or null if it can't be parsed. */
export function normalizeRepo(url: string | null | undefined): string | null {
  if (!url) return null;
  let s = url.trim().replace(/\.git$/, "");
  // scp-style: git@github.com:owner/repo
  const scp = s.match(/^[^@]+@[^:]+:(.+)$/);
  if (scp) return scp[1].replace(/^\/+/, "");
  // url-style: https://github.com/owner/repo, ssh://git@host/owner/repo
  const m = s.match(/^[a-z]+:\/\/[^/]+\/(.+)$/i);
  if (m) return m[1].replace(/^\/+/, "");
  return null;
}

export interface GitCommit {
  sha: string;
  authoredAt: string; // ISO
  subject: string;
  author: string; // author name (%an)
  authorEmail: string; // author email (%ae)
  branch: string | null;
}

/** The configured git identity for a working tree: { name, email }. */
export async function gitIdentity(dir: string): Promise<{ name: string | null; email: string | null }> {
  const read = async (key: string) => {
    try {
      const out = await $`git -C ${dir} config ${key}`.quiet().text();
      return out.trim() || null;
    } catch {
      return null;
    }
  };
  return { name: await read("user.name"), email: await read("user.email") };
}

/** Read the remote URL for a repo dir, or null. */
export async function remoteUrl(dir: string): Promise<string | null> {
  try {
    const out = await $`git -C ${dir} remote get-url origin`.quiet().text();
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * List commits in a repo. Returns them newest-first with ISO author dates.
 * `dir` may be any path inside the working tree.
 */
export async function logCommits(dir: string, opts: { since?: string; max?: number } = {}): Promise<GitCommit[]> {
  const args = ["-C", dir, "log", "--all", "--date=iso-strict", "--pretty=format:%H%x1f%aI%x1f%an%x1f%ae%x1f%s"];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.max) args.push(`-n${opts.max}`);
  let text: string;
  try {
    text = await $`git ${args}`.quiet().text();
  } catch {
    return [];
  }
  const commits: GitCommit[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const [sha, authoredAt, author, authorEmail, subject] = line.split("\x1f");
    commits.push({ sha, authoredAt, author, authorEmail, subject, branch: null });
  }
  return commits;
}

/** Which branches contain a given commit (local branches). */
export async function branchesContaining(dir: string, sha: string): Promise<string[]> {
  try {
    const out = await $`git -C ${dir} branch --all --contains ${sha} --format=%(refname:short)`.quiet().text();
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Resolve a revspec (e.g. HEAD, a short sha, a branch) to a full sha in dir. */
export async function resolveSha(dir: string, rev: string): Promise<string | null> {
  try {
    const out = await $`git -C ${dir} rev-parse ${rev}`.quiet().text();
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Metadata for a single commit, or null if it can't be read. */
export async function showCommit(dir: string, sha: string): Promise<Omit<GitCommit, "branch"> | null> {
  try {
    const out = await $`git -C ${dir} show -s --date=iso-strict --pretty=format:%H%x1f%aI%x1f%an%x1f%ae%x1f%s ${sha}`
      .quiet()
      .text();
    const [h, authoredAt, author, authorEmail, subject] = out.trim().split("\x1f");
    return { sha: h, authoredAt, author, authorEmail, subject };
  } catch {
    return null;
  }
}

/** Top-level dir of the working tree containing `dir`, or null. */
export async function repoRoot(dir: string): Promise<string | null> {
  try {
    const out = await $`git -C ${dir} rev-parse --show-toplevel`.quiet().text();
    return out.trim() || null;
  } catch {
    return null;
  }
}
