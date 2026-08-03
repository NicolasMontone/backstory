import { $ } from "bun";

export interface PrInfo {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  repo: string; // owner/repo
  commits: string[]; // full SHAs
}

/**
 * Fetch PR metadata + its commit SHAs via the `gh` CLI. `dir` selects the repo
 * context; pass `repo` (owner/name) to query a repo other than the cwd's.
 */
export async function fetchPr(num: number, opts: { dir?: string; repo?: string } = {}): Promise<PrInfo | null> {
  const args = ["pr", "view", String(num), "--json", "number,title,headRefName,baseRefName,url,commits"];
  if (opts.repo) args.push("--repo", opts.repo);
  try {
    const cwd = opts.dir ?? process.cwd();
    const out = await $`gh ${args}`.cwd(cwd).quiet().text();
    const o = JSON.parse(out);
    // Derive owner/repo from the PR url (https://github.com/owner/repo/pull/N).
    const m = String(o.url).match(/github\.com\/([^/]+\/[^/]+)\/pull\//);
    return {
      number: o.number,
      title: o.title,
      headRefName: o.headRefName,
      baseRefName: o.baseRefName,
      url: o.url,
      repo: opts.repo ?? (m ? m[1] : ""),
      commits: (o.commits ?? []).map((c: any) => c.oid as string),
    };
  } catch {
    return null;
  }
}

/** Is the gh CLI available and authenticated? */
export async function ghReady(): Promise<boolean> {
  try {
    await $`gh auth status`.quiet();
    return true;
  } catch {
    return false;
  }
}
