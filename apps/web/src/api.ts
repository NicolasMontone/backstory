import type {
  CommitReport,
  ActivityPoint,
  LinkedCommit,
  PrReport,
  SearchHit,
  SessionListItem,
  SessionWithPrompts,
  Stats,
} from "@backstory/cli";

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

export const api = {
  stats: () => j<Stats>("/api/stats"),
  timeline: (days = 90) => j<ActivityPoint[]>(`/api/timeline?days=${days}`),
  sessions: (repo?: string) =>
    j<SessionListItem[]>(`/api/sessions${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`),
  session: (id: string) => j<SessionWithPrompts>(`/api/session/${encodeURIComponent(id)}`),
  sessionCommits: (id: string) => j<LinkedCommit[]>(`/api/session/${encodeURIComponent(id)}/commits`),
  openSession: (id: string) => fetch(`/api/session/${encodeURIComponent(id)}/open`, { method: "POST" }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
    return r.json() as Promise<{ provider: string; command: string }>;
  }),
  search: (q: string) => j<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  commit: (sha: string) => j<CommitReport>(`/api/commit/${encodeURIComponent(sha)}`),
  pr: (number: number) => j<PrReport>(`/api/pr/${number}`),
};

export type { ActivityPoint, CommitReport, LinkedCommit, PrReport, SearchHit, SessionListItem, SessionWithPrompts, Stats };
