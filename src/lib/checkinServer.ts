import { adminDb } from './firebaseAdmin';

// Server-only. Check-ins live in events/{code}/checkins/{playerId} = { at: <ms> }, written only through the admin
// routes (Admin SDK), so a player can't mark themselves as arrived by editing their own record.

const checkins = (code: string) => adminDb.collection(`events/${code}/checkins`);

export interface AttendanceRow {
  id: string;
  name: string;
  /** When the player was checked in (ms), or null if they haven't arrived. */
  checkedInAt: number | null;
  /** Whether the player uploaded a payment proof (the image itself is only served by `previewPlayer`). */
  hasProof: boolean;
  /** Registered without the receipt (flexible registration) and not confirmed yet. */
  tentative: boolean;
}

/** Every registered player with their check-in time, sorted by name. */
export async function listAttendance(code: string): Promise<AttendanceRow[]> {
  const [players, arrivals] = await Promise.all([
    adminDb.collection(`events/${code}/players`).get(),
    checkins(code).get(),
  ]);
  const at = new Map(arrivals.docs.map((d) => [d.id, d.data().at as number]));
  return players.docs
    .map((d) => ({ id: d.id, name: (d.data().name as string) ?? '', checkedInAt: at.get(d.id) ?? null, hasProof: !!d.data().paymentProofUrl, tentative: d.data().registrationStatus === 'tentative' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlayerPreview {
  id: string;
  name: string;
  proofUrl: string | null;
  checkedInAt: number | null;
}

/**
 * What the door needs to decide about one player before letting them in — their payment proof and whether they
 * already arrived. Looked up by ticket code or player id; writes nothing. Null if there is no such player.
 */
export async function previewPlayer(code: string, ref: { ticketCode?: string; playerId?: string }): Promise<PlayerPreview | null> {
  let snap;
  if (ref.ticketCode?.trim()) {
    const q = await adminDb.collection(`events/${code}/players`).where('ticketCode', '==', ref.ticketCode.trim().toUpperCase()).limit(1).get();
    snap = q.empty ? null : q.docs[0];
  } else if (ref.playerId) {
    const d = await adminDb.doc(`events/${code}/players/${ref.playerId}`).get();
    snap = d.exists ? d : null;
  }
  if (!snap) return null;
  const data = snap.data()!;
  return {
    id: snap.id,
    name: (data.name as string) ?? '',
    proofUrl: (data.paymentProofUrl as string | null) ?? null,
    checkedInAt: await getCheckInTime(code, snap.id),
  };
}

/** Players looked up by ticket code (case-insensitive), or null. */
export async function findPlayerByTicket(code: string, ticketCode: string): Promise<{ id: string; name: string } | null> {
  const snap = await adminDb.collection(`events/${code}/players`).where('ticketCode', '==', ticketCode.trim().toUpperCase()).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, name: (snap.docs[0].data().name as string) ?? '' };
}

/**
 * Marks a player as arrived. If they were already checked in, nothing changes and the original time is returned
 * (`already: true`) — scanning the same QR twice must not move their arrival.
 */
export async function checkIn(code: string, playerId: string): Promise<{ at: number; already: boolean }> {
  const ref = checkins(code).doc(playerId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return { at: snap.data()!.at as number, already: true };
    const at = Date.now();
    tx.set(ref, { at });
    return { at, already: false };
  });
}

export async function undoCheckIn(code: string, playerId: string): Promise<void> {
  await checkins(code).doc(playerId).delete();
}

export async function getCheckInTime(code: string, playerId: string): Promise<number | null> {
  const snap = await checkins(code).doc(playerId).get();
  return snap.exists ? (snap.data()!.at as number) : null;
}
