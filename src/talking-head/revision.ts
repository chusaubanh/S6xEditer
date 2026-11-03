/** Rào chắn revision: PUT có revision cũ hơn bản trên đĩa → 409 {error:"stale"}; ghi thành công → revision tăng 1. */
export type RevisionCheck =
  | { ok: true; next: number }
  | { ok: false; status: 409; body: { error: "stale"; diskRevision: number; incomingRevision: number } };

export function checkRevision(disk: { revision?: number } | null | undefined, incoming: { revision?: number }): RevisionCheck {
  const d = disk?.revision ?? 0;
  const i = incoming.revision ?? 0;
  if (i < d) return { ok: false, status: 409, body: { error: "stale", diskRevision: d, incomingRevision: i } };
  return { ok: true, next: Math.max(i, d) + 1 };
}
