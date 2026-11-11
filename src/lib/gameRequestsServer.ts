import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin';
import { isValidRequestId, requestIdFor, type GameRequestView } from './gameRequests';

// Server-only. Requests live in events/{code}/gameRequests/{id} and are only read and written through the API route
// (Admin SDK), so the Firestore rules don't have to allow anything for them. Names are not stored on the request —
// only player ids — so a player who edits their name or alias is shown with the new one.

const MAX_REQUESTS_PER_PLAYER = 5;
const MAX_REQUESTS_PER_EVENT = 200;

const col = (code: string) => adminDb.collection(`events/${code}/gameRequests`);

/** Every request of the event, with names resolved from the point of view of `viewerId`, most wanted first. */
export async function listGameRequests(code: string, viewerId: string): Promise<GameRequestView[]> {
  const [requests, players] = await Promise.all([col(code).get(), adminDb.collection(`events/${code}/players`).get()]);
  const nameOf = new Map(players.docs.map((p) => [p.id, ((p.data().name as string) ?? '').trim() || 'Alguien']));
  return requests.docs
    .map((d) => {
      const r = d.data();
      const ids = (r.requesterIds as string[] | undefined) ?? [];
      const claimedById = (r.claimedById as string | null | undefined) ?? null;
      return {
        id: d.id,
        bggId: (r.bggId as string | null) ?? null,
        name: (r.name as string) ?? '',
        year: (r.year as string | null) ?? null,
        imageUrl: (r.imageUrl as string | null) ?? null,
        bggUrl: (r.bggUrl as string | null) ?? null,
        others: ids.filter((id) => id !== viewerId).map((id) => nameOf.get(id) ?? 'Alguien'),
        iRequested: ids.includes(viewerId),
        claimedBy: claimedById ? nameOf.get(claimedById) ?? 'Alguien' : null,
        iClaimed: claimedById === viewerId,
        createdAt: (r.createdAt as number) ?? 0,
      } satisfies GameRequestView;
    })
    .sort((a, b) => (b.others.length + (b.iRequested ? 1 : 0)) - (a.others.length + (a.iRequested ? 1 : 0)) || b.createdAt - a.createdAt);
}

export type RequestAction =
  | { action: 'request'; name: unknown; bggId?: unknown; year?: unknown; imageUrl?: unknown }
  | { action: 'unrequest' | 'claim' | 'unclaim'; id: unknown };

const cleanText = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Applies one action of a player (identified by their ticket) to the requests. */
export async function applyRequestAction(code: string, playerId: string, body: RequestAction): Promise<{ ok: boolean; reason?: string }> {
  if (body.action === 'request') {
    const name = cleanText(body.name, 80);
    if (!name) return { ok: false, reason: 'invalid-name' };
    const bggId = typeof body.bggId === 'string' && /^\d{1,8}$/.test(body.bggId) ? body.bggId : null;
    const year = typeof body.year === 'string' && /^\d{1,4}$/.test(body.year) ? body.year : null;
    const imageUrl = typeof body.imageUrl === 'string' && /^https:\/\//.test(body.imageUrl) && body.imageUrl.length <= 400 ? body.imageUrl : null;
    const ref = col(code).doc(requestIdFor(bggId, name));

    return adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        tx.update(ref, { requesterIds: FieldValue.arrayUnion(playerId) });
        return { ok: true };
      }
      // A new request: keep one person from filling the list, and the list from growing without bound
      const [mine, all] = await Promise.all([col(code).where('requesterIds', 'array-contains', playerId).count().get(), col(code).count().get()]);
      if (mine.data().count >= MAX_REQUESTS_PER_PLAYER) return { ok: false, reason: 'too-many-yours' };
      if (all.data().count >= MAX_REQUESTS_PER_EVENT) return { ok: false, reason: 'list-full' };
      tx.set(ref, {
        bggId, name, year, imageUrl, bggUrl: bggId ? `https://boardgamegeek.com/boardgame/${bggId}` : null,
        requesterIds: [playerId], claimedById: null, createdAt: Date.now(),
      });
      return { ok: true };
    });
  }

  if (!isValidRequestId(body.id)) return { ok: false, reason: 'invalid-id' };
  const ref = col(code).doc(body.id);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not-found' };
    const data = snap.data()!;
    const ids = ((data.requesterIds as string[] | undefined) ?? []);
    const claimedById = (data.claimedById as string | null | undefined) ?? null;

    if (body.action === 'unrequest') {
      const rest = ids.filter((id) => id !== playerId);
      // Nobody left asking for it and nobody bringing it: the request is gone
      if (rest.length === 0 && !claimedById) tx.delete(ref);
      else tx.update(ref, { requesterIds: rest });
    } else if (body.action === 'claim') {
      if (claimedById && claimedById !== playerId) return { ok: false, reason: 'already-claimed' };
      tx.update(ref, { claimedById: playerId });
    } else {
      if (claimedById !== playerId) return { ok: false, reason: 'not-yours' };
      tx.update(ref, { claimedById: null });
    }
    return { ok: true };
  });
}
