import { adminDb } from './firebaseAdmin';

// Server-only. Check-ins live in events/{code}/checkins/{playerId} = { at: <ms> }, written only through the admin
// routes (Admin SDK), so a player can't mark themselves as arrived by editing their own record.

const checkins = (code: string) => adminDb.collection(`events/${code}/checkins`);

export interface AttendanceRow {
  id: string;
  name: string;
  /** When the player was checked in (ms), or null if they haven't arrived. */
  checkedInAt: number | null;
}

/** Every registered player with their check-in time, sorted by name. */
export async function listAttendance(code: string): Promise<AttendanceRow[]> {
  const [players, arrivals] = await Promise.all([
    adminDb.collection(`events/${code}/players`).get(),
    checkins(code).get(),
  ]);
  const at = new Map(arrivals.docs.map((d) => [d.id, d.data().at as number]));
  return players.docs
    .map((d) => ({ id: d.id, name: (d.data().name as string) ?? '', checkedInAt: at.get(d.id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
