import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

// Title -> stable kebab slug. Collisions resolved against a set of existing slugs.
export function slugify(title: string, existing: Set<string> = new Set()): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "task";
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
