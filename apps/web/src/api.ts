import type {
  CommitReport,
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
  sessions: (repo?: string) =>
    j<SessionListItem[]>(`/api/sessions${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`),
  session: (id: string) => j<SessionWithPrompts>(`/api/session/${encodeURIComponent(id)}`),
  search: (q: string) => j<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  commit: (sha: string) => j<CommitReport>(`/api/commit/${encodeURIComponent(sha)}`),
};

export type { CommitReport, SearchHit, SessionListItem, SessionWithPrompts, Stats };
