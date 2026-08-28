import {
  doc, collection, getDoc, getDocs, addDoc, updateDoc,
  query, where, onSnapshot, Timestamp, writeBatch,
  orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MeepleEvent, EventAdminConfig, Game, Player, Table } from './types';
import type { FakePlayerDraft } from './fakeData';
import { randomInterest, randomOwnGameInterest } from './fakeData';
import { generateTicketCodeCandidate } from './ticketCode';

// ── Events ────────────────────────────────────────────────────────────────────

export async function getEvent(code: string): Promise<MeepleEvent | null> {
  const snap = await getDoc(doc(db, 'events', code));
  if (!snap.exists()) return null;
  const data = snap.data() as MeepleEvent;
  // Migrates events created before "breaks" existed (or its old single-lunchBreak shape)
  if (!Array.isArray(data.settings?.breaks)) {
    const legacyLunch = (data.settings as unknown as { lunchBreak?: { start: string; end: string } })?.lunchBreak;
    data.settings = { ...data.settings, breaks: legacyLunch ? [{ label: 'Almuerzo', ...legacyLunch }] : [] };
  }
  return data;
}

export async function createEvent(
  code: string,
  adminToken: string,
  data: Omit<MeepleEvent, 'status'>
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'events', code), { ...data, status: 'open' });
  batch.set(doc(db, 'events', code, 'private', 'config'), { adminToken });
  await batch.commit();
}

/** Admin token lives outside the public event doc so it's never returned to player reads */
export async function getEventAdminConfig(code: string): Promise<EventAdminConfig | null> {
  const snap = await getDoc(doc(db, 'events', code, 'private', 'config'));
  return snap.exists() ? (snap.data() as EventAdminConfig) : null;
}

export async function verifyAdminToken(code: string, adminToken: string): Promise<boolean> {
  const config = await getEventAdminConfig(code);
  return !!config && config.adminToken === adminToken;
}

export async function updateEventStatus(code: string, status: MeepleEvent['status']): Promise<void> {
  await updateDoc(doc(db, 'events', code), { status });
}

export async function updateEventSettings(code: string, settings: MeepleEvent['settings']): Promise<void> {
  await updateDoc(doc(db, 'events', code), { settings });
}

export async function updateEventDetails(
  code: string,
  details: Partial<Pick<MeepleEvent, 'mapUrl' | 'name' | 'date' | 'startTime' | 'endTime' | 'location'>>
): Promise<void> {
  await updateDoc(doc(db, 'events', code), details);
}


// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGames(eventCode: string): Promise<Game[]> {
  const snap = await getDocs(collection(db, 'events', eventCode, 'games'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Game));
}

export async function addGame(eventCode: string, game: Omit<Game, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'events', eventCode, 'games'), game);
  return ref.id;
}

/** Patches in the real player id once it exists — games are created before the owning player during registration */
export async function setGameOwner(eventCode: string, gameId: string, ownerPlayerId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'games', gameId), { ownerPlayerId });
}

export function subscribeGames(eventCode: string, cb: (games: Game[]) => void) {
  return onSnapshot(collection(db, 'events', eventCode, 'games'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Game)))
  );
}

// ── Players ───────────────────────────────────────────────────────────────────

export async function getPlayers(eventCode: string): Promise<Player[]> {
  const snap = await getDocs(
    query(collection(db, 'events', eventCode, 'players'), orderBy('registeredAt'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Player));
}

export async function getPlayerByTicketCode(eventCode: string, ticketCode: string): Promise<Player | null> {
  const snap = await getDocs(
    query(collection(db, 'events', eventCode, 'players'), where('ticketCode', '==', ticketCode))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Player;
}

/** Looks up an already-registered player by email or phone, to prevent duplicate sign-ups */
export async function findPlayerByContact(
  eventCode: string,
  email: string | null,
  phone: string | null
): Promise<Player | null> {
  const playersRef = collection(db, 'events', eventCode, 'players');
  if (email) {
    const snap = await getDocs(query(playersRef, where('email', '==', email)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() } as Player;
  }
  if (phone) {
    const snap = await getDocs(query(playersRef, where('phone', '==', phone)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() } as Player;
  }
  return null;
}

export async function addPlayer(eventCode: string, player: Omit<Player, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'events', eventCode, 'players'), {
    ...player,
    registeredAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePlayerInterests(
  eventCode: string,
  playerId: string,
  interests: Player['interests']
): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'players', playerId), { interests });
}

export async function updatePlayerWishlist(
  eventCode: string,
  playerId: string,
  data: { interests: Player['interests']; canExplain: string[] }
): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'players', playerId), data);
}

export function subscribePlayers(eventCode: string, cb: (players: Player[]) => void) {
  return onSnapshot(
    query(collection(db, 'events', eventCode, 'players'), orderBy('registeredAt')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Player)))
  );
}

// ── Tables ────────────────────────────────────────────────────────────────────

export async function getTables(eventCode: string): Promise<Table[]> {
  const snap = await getDocs(collection(db, 'events', eventCode, 'tables'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Table));
}

export async function saveProposedTables(
  eventCode: string,
  proposals: Omit<Table, 'id'>[]
): Promise<void> {
  const batch = writeBatch(db);
  for (const p of proposals) {
    const ref = doc(collection(db, 'events', eventCode, 'tables'));
    batch.set(ref, p);
  }
  await batch.commit();
}

export async function updateTableStatus(
  eventCode: string,
  tableId: string,
  status: Table['status'],
  isManuallyEdited = false
): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'tables', tableId), {
    status,
    ...(isManuallyEdited && { isManuallyEdited: true }),
  });
}

export async function updateTable(
  eventCode: string,
  tableId: string,
  fields: Partial<Pick<Table, 'startTime' | 'endTime' | 'playerIds' | 'explainerId'>>
): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'tables', tableId), {
    ...fields,
    isManuallyEdited: true,
  });
}

export function subscribeTables(eventCode: string, cb: (tables: Table[]) => void) {
  return onSnapshot(collection(db, 'events', eventCode, 'tables'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Table)))
  );
}

/** Adds newly-interested players into an existing table's remaining seats (auto-fill, not a manual edit) */
export async function fillTableSeats(eventCode: string, tableId: string, playerIds: string[]): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'tables', tableId), { playerIds });
}

// ── Debug / demo seeding ──────────────────────────────────────────────────────

/** Deletes every player, game and table in the event — used to reset before reseeding demo data */
export async function resetEventData(eventCode: string): Promise<void> {
  const [playersSnap, gamesSnap, tablesSnap] = await Promise.all([
    getDocs(collection(db, 'events', eventCode, 'players')),
    getDocs(collection(db, 'events', eventCode, 'games')),
    getDocs(collection(db, 'events', eventCode, 'tables')),
  ]);
  const batch = writeBatch(db);
  playersSnap.docs.forEach((d) => batch.delete(d.ref));
  gamesSnap.docs.forEach((d) => batch.delete(d.ref));
  tablesSnap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/** Bulk-creates fake players + their games + randomized wishlist votes in one batch, for demos/testing */
export async function seedFakePlayers(eventCode: string, drafts: FakePlayerDraft[]): Promise<void> {
  const existingPlayers = await getPlayers(eventCode);
  const existingGames = await getGames(eventCode);
  const usedCodes = new Set(existingPlayers.map((p) => p.ticketCode));

  const batch = writeBatch(db);
  const playerRefs = drafts.map(() => doc(collection(db, 'events', eventCode, 'players')));
  const newGameIdsByPlayer: string[][] = drafts.map((draft, i) =>
    draft.games.map((g) => {
      const gameRef = doc(collection(db, 'events', eventCode, 'games'));
      batch.set(gameRef, {
        name: g.name,
        bggUrl: null,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
        durationMinutes: g.durationMinutes,
        complexity: g.complexity,
        ownerPlayerId: playerRefs[i].id,
        ownerName: draft.name,
      });
      return gameRef.id;
    })
  );

  const allGameIds = [...existingGames.map((g) => g.id), ...newGameIdsByPlayer.flat()];

  drafts.forEach((draft, i) => {
    let ticketCode = generateTicketCodeCandidate();
    while (usedCodes.has(ticketCode)) ticketCode = generateTicketCodeCandidate();
    usedCodes.add(ticketCode);

    const ownGameIds = newGameIdsByPlayer[i];
    const canExplainIds = ownGameIds.filter((_, gi) => draft.games[gi].canExplain);
    const interests: Record<string, string> = {};
    allGameIds.forEach((gid) => {
      interests[gid] = ownGameIds.includes(gid) ? randomOwnGameInterest() : randomInterest();
    });

    batch.set(playerRefs[i], {
      name: draft.name,
      firstName: draft.firstName,
      lastName: draft.lastName,
      alias: draft.alias,
      email: null,
      phone: null,
      arrivalTime: draft.arrivalTime,
      departureTime: draft.departureTime,
      registeredAt: serverTimestamp(),
      ticketCode,
      bringGameIds: ownGameIds,
      interests,
      canExplain: canExplainIds,
    });
  });

  await batch.commit();
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Tables assigned to a specific player (calculated, not stored) */
export function getPlayerTables(playerId: string, tables: Table[]): Table[] {
  return tables.filter(
    (t) => t.playerIds.includes(playerId) && t.status !== 'cancelled'
  );
}
