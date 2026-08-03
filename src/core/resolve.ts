import type { Projection, TaskStatus } from "../types.js";

export type Resolution =
  | { kind: "match"; id: string }
  | { kind: "ambiguous"; candidates: { id: string; title: string }[] }
  | { kind: "none" };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}

const STATUS_RANK: Record<TaskStatus, number> = {
  doing: 0,
  paused: 1,
  blocked: 2,
  todo: 3,
  done: 4,
};

/**
 * Deterministically resolve a loose phrase to a task. Exact slug wins outright.
 * A clear leader returns `match`; a close race returns `ambiguous` for Claude to confirm.
 */
export function resolve(
  p: Projection,
  query: string,
  opts: { includeDone?: boolean } = {},
): Resolution {
  const q = norm(query);
  if (!q) return { kind: "none" };
  if (p.tasks.has(query)) return { kind: "match", id: query }; // exact slug

  const qtok = new Set(tokens(query));
  const scored: { id: string; title: string; score: number; sr: number; at: string }[] = [];

  for (const t of p.tasks.values()) {
    if (t.status === "done" && !opts.includeDone) continue;
    const hayStr = norm(`${t.title} ${t.id} ${t.tags.join(" ")}`);
    let score = 0;
    if (hayStr === q || norm(t.id) === q) score += 100;
    if (hayStr.includes(q)) score += 40;
    const htok = tokens(`${t.title} ${t.id} ${t.tags.join(" ")}`);
    let overlap = 0;
    for (const tk of htok) if (qtok.has(tk)) overlap++;
    score += overlap * 20;
    if (score > 0) {
      scored.push({ id: t.id, title: t.title, score, sr: STATUS_RANK[t.status], at: t.createdAt });
    }
  }

  if (scored.length === 0) return { kind: "none" };
  scored.sort((a, b) => b.score - a.score || a.sr - b.sr || (a.at < b.at ? 1 : -1));

  const top = scored[0];
  const near = scored.filter((s) => top.score - s.score < 20).slice(0, 4);
  if (near.length === 1) return { kind: "match", id: near[0].id };
  return { kind: "ambiguous", candidates: near.map((s) => ({ id: s.id, title: s.title })) };
}
