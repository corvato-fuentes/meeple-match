import {
  doc, collection, getDoc, getDocs, addDoc, updateDoc,
  query, where, onSnapshot, Timestamp, writeBatch, runTransaction,
  orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MeepleEvent, EventAdminConfig, Game, Player, Table, InterestLevel } from './types';
import type { FakePlayerDraft, FakePlayerForTables, FakeGameForTables } from './fakeData';
import { randomInterest, randomOwnGameInterest, generateFakePostulatedTables } from './fakeData';
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
  // Migrates events created before the payment-proof feature existed
  if (data.settings?.paymentRequired == null) {
    data.settings = { ...data.settings, paymentRequired: false, paymentInfo: data.settings?.paymentInfo ?? null };
  }
  // Migrates events created before the registration banner existed
  if (data.settings?.registrationBannerUrl === undefined) {
    data.settings = { ...data.settings, registrationBannerUrl: null };
  }
  return data;
}

export async function createEvent(
  code: string,
  adminToken: string,
  data: MeepleEvent
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'events', code), data);
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

export async function updateEventSettings(code: string, settings: MeepleEvent['settings']): Promise<void> {
  await updateDoc(doc(db, 'events', code), { settings });
}

export async function updateEventDetails(
  code: string,
  details: Partial<Pick<MeepleEvent, 'mapUrl' | 'name' | 'date' | 'startTime' | 'endTime' | 'location'>>
): Promise<void> {
  await updateDoc(doc(db, 'events', code), details);
}

const GEN_LOCK_TIMEOUT_MS = 20_000; // safety net in case a previous run crashed without releasing

/**
 * Claims an exclusive lock on this event's table-generation step, stored as a plain field on the
 * event doc (no rules changes needed — updates to it are already allowed). Prevents two
 * concurrent regenerations (e.g. two players voting seconds apart) from each computing a full
 * schedule without seeing the other's writes, which was creating duplicate/overlapping tables.
 */
export async function acquireGenerationLock(eventCode: string): Promise<boolean> {
  const ref = doc(db, 'events', eventCode);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const lockedAt = (snap.data() as { genLockAt?: number } | undefined)?.genLockAt;
      if (lockedAt && Date.now() - lockedAt < GEN_LOCK_TIMEOUT_MS) return false;
      tx.update(ref, { genLockAt: Date.now() });
      return true;
    });
  } catch {
    return false;
  }
}

export async function releaseGenerationLock(eventCode: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode), { genLockAt: null });
}


// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGames(eventCode: string): Promise<Game[]> {
  const snap = await getDocs(collection(db, 'events', eventCode, 'games'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Game)).filter((g) => !g.deleted);
}

export async function addGame(eventCode: string, game: Omit<Game, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'events', eventCode, 'games'), game);
  return ref.id;
}

/** Patches in the real player id once it exists — games are created before the owning player during registration */
export async function setGameOwner(eventCode: string, gameId: string, ownerPlayerId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'games', gameId), { ownerPlayerId });
}

/** Lets a player edit a game they own (name/player counts/duration/complexity/BGG link) after registering. */
export async function updateGame(
  eventCode: string,
  gameId: string,
  fields: Partial<Pick<Game,
    'name' | 'bggUrl' | 'imageUrl' | 'minPlayers' | 'maxPlayers' | 'durationMinutes' | 'complexity' |
    'perPlayerMinutes' | 'setupMinutes' | 'explanationMinutes' | 'lendable'
  >>
): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'games', gameId), fields);
}

const INTEREST_RANK: Record<InterestLevel, number> = { yes: 2, no: 1 };

/**
 * Marks a set of games as copies of the same physical game (e.g. two players both loaded "The
 * Castles of Burgundy" under slightly different names). All copies get tagged with the same
 * groupId — the primary's id — so the scheduling algorithm treats them as one game with N
 * concurrent copies instead of N unrelated games. Any votes/canExplain/repeat already recorded
 * on a secondary copy, and any table already referencing one, are folded into the primary.
 */
export async function mergeGames(eventCode: string, gameIds: string[], primaryId: string): Promise<void> {
  if (gameIds.length < 2 || !gameIds.includes(primaryId)) return;
  const secondaryIds = gameIds.filter((id) => id !== primaryId);

  const [playersSnap, tablesSnap, gameDocs] = await Promise.all([
    getDocs(collection(db, 'events', eventCode, 'players')),
    getDocs(collection(db, 'events', eventCode, 'tables')),
    Promise.all(gameIds.map((id) => getDoc(doc(db, 'events', eventCode, 'games', id)))),
  ]);
  const groupGames = gameDocs.map((d) => (d.exists() ? { ...(d.data() as Game), id: d.id } : null)).filter((g): g is Game => !!g);
  const primaryName = groupGames.find((g) => g.id === primaryId)?.name;
  // Copies are often entered independently (e.g. someone else's box, a different BGG lookup) and
  // may disagree on how long the game actually takes — only the primary's duration ever gets used
  // for scheduling, so take the longest one in the group rather than silently keeping whichever
  // happened to be marked primary.
  const longestDuration = Math.max(...groupGames.map((g) => g.durationMinutes));

  const batch = writeBatch(db);
  gameIds.forEach((id) => batch.update(doc(db, 'events', eventCode, 'games', id), { groupId: primaryId }));
  batch.update(doc(db, 'events', eventCode, 'games', primaryId), { durationMinutes: longestDuration });

  playersSnap.docs.forEach((playerDoc) => {
    const p = playerDoc.data() as Player;
    const touchesGroup = secondaryIds.some(
      (id) => id in p.interests || p.canExplain.includes(id) || (p.repeatGameIds ?? []).includes(id)
    );
    if (!touchesGroup) return;

    const votes = [p.interests[primaryId], ...secondaryIds.map((id) => p.interests[id])].filter(Boolean) as InterestLevel[];
    const bestVote = votes.sort((a, b) => INTEREST_RANK[b] - INTEREST_RANK[a])[0];
    const interests = { ...p.interests };
    secondaryIds.forEach((id) => delete interests[id]);
    if (bestVote) interests[primaryId] = bestVote; else delete interests[primaryId];

    const canExplain = new Set(p.canExplain.filter((id) => !secondaryIds.includes(id)));
    if (secondaryIds.some((id) => p.canExplain.includes(id))) canExplain.add(primaryId);

    const repeatGameIds = new Set((p.repeatGameIds ?? []).filter((id) => !secondaryIds.includes(id)));
    if (secondaryIds.some((id) => (p.repeatGameIds ?? []).includes(id))) repeatGameIds.add(primaryId);

    batch.update(playerDoc.ref, { interests, canExplain: [...canExplain], repeatGameIds: [...repeatGameIds] });
  });

  tablesSnap.docs.forEach((tableDoc) => {
    const t = tableDoc.data() as Table;
    if (secondaryIds.includes(t.gameId)) {
      batch.update(tableDoc.ref, { gameId: primaryId, ...(primaryName && { gameName: primaryName }) });
    }
  });

  await batch.commit();
}

/**
 * Merges games that are obviously the same physical game, so each extra copy becomes another
 * concurrent copy of one game instead of a separate game with its own votes and tables. Games
 * count as duplicates when they share the same `key` (their BGG link for real games; their name
 * for demo data that has no BGG link). Safe to call repeatedly — sets that are already one group
 * are left alone. Must run AFTER the new game's owner has written their votes, since
 * mergeGames is what folds those votes onto the primary copy.
 */
export async function autoMergeDuplicates(eventCode: string, key: 'bggUrl' | 'name'): Promise<void> {
  const games = await getGames(eventCode);
  const sets = new Map<string, Game[]>();
  for (const g of games) {
    const k = key === 'name' ? g.name.trim().toLowerCase() : g.bggUrl;
    if (!k) continue;
    sets.set(k, [...(sets.get(k) ?? []), g]);
  }
  for (const members of sets.values()) {
    if (members.length < 2) continue;
    const primaryId = members.find((g) => g.groupId)?.groupId ?? members[0].id;
    if (members.every((g) => g.groupId === primaryId)) continue;
    await mergeGames(eventCode, [...new Set([...members.map((g) => g.id), primaryId])], primaryId);
  }
}

/** Pulls a single game back out of its merge group — it becomes standalone again. Doesn't touch votes. */
export async function ungroupGame(eventCode: string, gameId: string): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'games', gameId), { groupId: null });
}

/** Every field on a Player that can carry a reference to a gameId — used when a game gets deleted or its votes transferred elsewhere. */
const VOTE_LIST_FIELDS = ['canExplain', 'playedGameIds', 'repeatGameIds'] as const;

function playerTouchesGame(p: Player, gameId: string): boolean {
  return gameId in p.interests || VOTE_LIST_FIELDS.some((field) => (p[field] ?? []).includes(gameId));
}

/**
 * Builds the field updates that move one player's votes/knowledge from `fromId` to `toId` (a
 * yes/no vote, canExplain, playedGameIds, repeatGameIds), used both when a
 * merge-group's primary/secondary gets deleted and when an admin transfers a deleted game's votes
 * onto another. Never overwrites an existing vote/flag already on `toId`. Returns null if this
 * player has nothing on `fromId` to move.
 */
function migratedVoteFields(p: Player, fromId: string, toId: string): Record<string, unknown> | null {
  if (!playerTouchesGame(p, fromId)) return null;
  const interests = { ...p.interests };
  const vote = interests[fromId];
  delete interests[fromId];
  if (vote && !(toId in interests)) interests[toId] = vote;
  const fields: Record<string, unknown> = { interests };
  for (const field of VOTE_LIST_FIELDS) {
    const list = new Set((p[field] ?? []).filter((id) => id !== fromId));
    if ((p[field] ?? []).includes(fromId)) list.add(toId);
    fields[field] = [...list];
  }
  return fields;
}

/**
 * Removes a game a player brought. If it's grouped with other copies, any votes on it always
 * migrate automatically to a surviving copy — the group's primary if a secondary was deleted, or
 * a newly-promoted copy if the primary itself was deleted — so deleting one linked copy never
 * erases votes for the game other players are still bringing. If it's a standalone game (or the
 * last copy in its group) that nobody voted on, it's just deleted outright. But if it gathered any
 * votes/knowledge with nowhere to migrate to, it's soft-deleted instead — kept (flagged `deleted`,
 * hidden from every player-facing list and the algorithm) so the admin can transfer those votes to
 * another game afterward rather than losing them.
 */
export async function removePlayerGame(eventCode: string, playerId: string, gameId: string): Promise<void> {
  const [gamesSnap, playersSnap, tablesSnap] = await Promise.all([
    getDocs(collection(db, 'events', eventCode, 'games')),
    getDocs(collection(db, 'events', eventCode, 'players')),
    getDocs(collection(db, 'events', eventCode, 'tables')),
  ]);

  const allGames = gamesSnap.docs.map((d) => ({ ...(d.data() as Game), id: d.id }));
  const target = allGames.find((g) => g.id === gameId);
  const canonicalId = target?.groupId ?? gameId;
  const isPrimary = canonicalId === gameId;
  const groupMembers = allGames.filter((g) => g.id !== gameId && (g.groupId ?? g.id) === canonicalId);
  // Whichever copy inherits this one's votes: a promoted member if the primary itself was deleted,
  // or simply the (unchanged) existing primary if a secondary was deleted.
  const survivor = isPrimary ? (groupMembers[0] ?? null) : (allGames.find((g) => g.id === canonicalId) ?? null);

  const batch = writeBatch(db);

  if (survivor) {
    batch.delete(doc(db, 'events', eventCode, 'games', gameId));
    if (isPrimary) {
      batch.update(doc(db, 'events', eventCode, 'games', survivor.id), { groupId: null });
      groupMembers
        .filter((g) => g.id !== survivor.id)
        .forEach((g) => batch.update(doc(db, 'events', eventCode, 'games', g.id), { groupId: survivor.id }));
    }
    playersSnap.docs.forEach((playerDoc) => {
      const p = playerDoc.data() as Player;
      const fields = migratedVoteFields(p, gameId, survivor.id) ?? {};
      if (playerDoc.id === playerId) fields.bringGameIds = p.bringGameIds.filter((id) => id !== gameId);
      if (Object.keys(fields).length > 0) batch.update(playerDoc.ref, fields);
    });
    tablesSnap.docs.forEach((tableDoc) => {
      const table = tableDoc.data() as Table;
      if (table.gameId === gameId) batch.update(tableDoc.ref, { gameId: survivor.id, gameName: survivor.name });
    });
  } else {
    const hasVotes = playersSnap.docs.some((d) => playerTouchesGame(d.data() as Player, gameId));
    if (hasVotes) {
      batch.update(doc(db, 'events', eventCode, 'games', gameId), { deleted: true });
    } else {
      batch.delete(doc(db, 'events', eventCode, 'games', gameId));
    }
    playersSnap.docs.forEach((playerDoc) => {
      if (playerDoc.id !== playerId) return;
      const p = playerDoc.data() as Player;
      batch.update(playerDoc.ref, { bringGameIds: p.bringGameIds.filter((id) => id !== gameId) });
    });
    tablesSnap.docs.forEach((tableDoc) => {
      const table = tableDoc.data() as Table;
      if (table.gameId === gameId && table.status !== 'cancelled') {
        batch.update(tableDoc.ref, { status: 'cancelled', playerIds: [] });
      }
    });
  }

  await batch.commit();
}

/**
 * Admin action: moves every player's votes/knowledge from a soft-deleted game onto a live one
 * (e.g. it turns out to have been a duplicate that never got merged), then permanently removes
 * the now-empty deleted game.
 */
export async function transferGameVotes(eventCode: string, fromGameId: string, toGameId: string): Promise<void> {
  const toSnap = await getDoc(doc(db, 'events', eventCode, 'games', toGameId));
  if (!toSnap.exists()) return;
  const toGame = { ...(toSnap.data() as Game), id: toGameId };

  const [playersSnap, tablesSnap] = await Promise.all([
    getDocs(collection(db, 'events', eventCode, 'players')),
    getDocs(collection(db, 'events', eventCode, 'tables')),
  ]);

  const batch = writeBatch(db);
  playersSnap.docs.forEach((playerDoc) => {
    const fields = migratedVoteFields(playerDoc.data() as Player, fromGameId, toGameId);
    if (fields) batch.update(playerDoc.ref, fields);
  });
  tablesSnap.docs.forEach((tableDoc) => {
    const table = tableDoc.data() as Table;
    if (table.gameId === fromGameId) batch.update(tableDoc.ref, { gameId: toGameId, gameName: toGame.name });
  });
  batch.delete(doc(db, 'events', eventCode, 'games', fromGameId));
  await batch.commit();
}

/** Admin action: permanently discards a soft-deleted game and any lingering votes on it, with nowhere for them to go. */
export async function discardDeletedGame(eventCode: string, gameId: string): Promise<void> {
  const playersSnap = await getDocs(collection(db, 'events', eventCode, 'players'));
  const batch = writeBatch(db);
  playersSnap.docs.forEach((playerDoc) => {
    const p = playerDoc.data() as Player;
    if (!playerTouchesGame(p, gameId)) return;
    const interests = { ...p.interests };
    delete interests[gameId];
    const fields: Record<string, unknown> = { interests };
    for (const field of VOTE_LIST_FIELDS) fields[field] = (p[field] ?? []).filter((id) => id !== gameId);
    batch.update(playerDoc.ref, fields);
  });
  batch.delete(doc(db, 'events', eventCode, 'games', gameId));
  await batch.commit();
}

export function subscribeGames(eventCode: string, cb: (games: Game[]) => void) {
  return onSnapshot(collection(db, 'events', eventCode, 'games'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Game)).filter((g) => !g.deleted))
  );
}

/** Admin-only: includes soft-deleted games too, so their pending votes can be reviewed and transferred. */
export function subscribeAllGames(eventCode: string, cb: (games: Game[]) => void) {
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

/** Updates a player's arrival/departure window — editable by the player themselves or the admin. */
export async function updatePlayerTimes(
  eventCode: string,
  playerId: string,
  arrivalTime: string,
  departureTime: string
): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'players', playerId), { arrivalTime, departureTime });
}

/** Admin-only flag — marks a player as event staff/organizer, surfaced on the Organizadores page. */
export async function setPlayerOrganizer(eventCode: string, playerId: string, isOrganizer: boolean): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'players', playerId), { isOrganizer });
}

/**
 * Pulls one player out of a single table they're already seated at (or explaining) — e.g. leaving
 * an already-confirmed table. Mirrors the per-table cleanup in deletePlayer.
 */
export async function removePlayerFromTable(eventCode: string, table: Table, playerId: string): Promise<void> {
  const remainingPlayerIds = table.playerIds.filter((id) => id !== playerId);
  const fields: Partial<Pick<Table, 'playerIds' | 'status' | 'explainerId'>> = { playerIds: remainingPlayerIds };
  if (remainingPlayerIds.length === 0) fields.status = 'cancelled';
  else if (table.explainerId === playerId) fields.explainerId = remainingPlayerIds[0];
  await updateDoc(doc(db, 'events', eventCode, 'tables', table.id), fields);
}


/**
 * Adds a game brought by an already-registered player (post-registration) and links it to their bringGameIds.
 * currentBringGameIds is passed in rather than re-read to avoid an extra round-trip.
 */
export async function addPlayerGame(
  eventCode: string,
  playerId: string,
  ownerName: string,
  currentBringGameIds: string[],
  game: Omit<Game, 'id' | 'ownerPlayerId' | 'ownerName'>
): Promise<string> {
  const gameId = await addGame(eventCode, { ...game, ownerPlayerId: playerId, ownerName });
  await updateDoc(doc(db, 'events', eventCode, 'players', playerId), {
    bringGameIds: [...currentBringGameIds, gameId],
  });
  return gameId;
}

/**
 * Removes a player, the games they brought, their seat/explainer slot on any table (cancelling
 * tables left with no players), and any dangling votes other players had on the deleted games.
 * If one of their games is the primary of a merge group with a surviving copy (owned by someone
 * else), that copy is promoted to primary instead — same group-aware logic as removePlayerGame,
 * so deleting this player doesn't erase everyone else's votes for a game still being brought.
 */
export async function deletePlayer(eventCode: string, playerId: string): Promise<void> {
  const playerSnap = await getDoc(doc(db, 'events', eventCode, 'players', playerId));
  if (!playerSnap.exists()) return;
  const player = playerSnap.data() as Player;
  const ownedGameIds = new Set(player.bringGameIds);

  const [tablesSnap, playersSnap, gamesSnap] = await Promise.all([
    getDocs(collection(db, 'events', eventCode, 'tables')),
    getDocs(collection(db, 'events', eventCode, 'players')),
    ownedGameIds.size > 0 ? getDocs(collection(db, 'events', eventCode, 'games')) : Promise.resolve(null),
  ]);

  const allGames = gamesSnap ? gamesSnap.docs.map((d) => ({ ...(d.data() as Game), id: d.id })) : [];
  // Only a group primary can trigger a promotion; a surviving copy must belong to someone else
  // (this player's own other games are being deleted right alongside it).
  const promotions = new Map<string, Game>(); // deleted primary's id -> promoted copy
  ownedGameIds.forEach((gameId) => {
    const target = allGames.find((g) => g.id === gameId);
    const isPrimary = !target?.groupId || target.groupId === gameId;
    if (!isPrimary) return;
    const survivor = allGames.find((g) => g.id !== gameId && !ownedGameIds.has(g.id) && (g.groupId ?? g.id) === gameId);
    if (survivor) promotions.set(gameId, survivor);
  });
  const fullyRemovedGameIds = new Set([...ownedGameIds].filter((id) => !promotions.has(id)));

  const batch = writeBatch(db);
  batch.delete(doc(db, 'events', eventCode, 'players', playerId));
  ownedGameIds.forEach((gameId) => batch.delete(doc(db, 'events', eventCode, 'games', gameId)));

  promotions.forEach((newPrimary, oldPrimaryId) => {
    batch.update(doc(db, 'events', eventCode, 'games', newPrimary.id), { groupId: null });
    allGames
      .filter((g) => g.id !== newPrimary.id && !ownedGameIds.has(g.id) && (g.groupId ?? g.id) === oldPrimaryId)
      .forEach((g) => batch.update(doc(db, 'events', eventCode, 'games', g.id), { groupId: newPrimary.id }));
  });

  tablesSnap.docs.forEach((tableDoc) => {
    const table = tableDoc.data() as Table;
    const wasSeated = table.playerIds.includes(playerId);
    const wasExplainer = table.explainerId === playerId;
    const promoted = promotions.get(table.gameId);
    if (promoted) {
      const fields: Record<string, unknown> = { gameId: promoted.id, gameName: promoted.name };
      const remainingPlayerIds = table.playerIds.filter((id) => id !== playerId);
      if (wasSeated) fields.playerIds = remainingPlayerIds;
      if (wasExplainer) {
        if (remainingPlayerIds.length === 0) fields.status = 'cancelled';
        else fields.explainerId = remainingPlayerIds[0];
      }
      batch.update(tableDoc.ref, fields);
      return;
    }
    if (fullyRemovedGameIds.has(table.gameId) && table.status !== 'cancelled') {
      batch.update(tableDoc.ref, { status: 'cancelled', playerIds: [] });
      return;
    }
    if (!wasSeated && !wasExplainer) return;
    const remainingPlayerIds = table.playerIds.filter((id) => id !== playerId);
    const fields: Partial<Pick<Table, 'playerIds' | 'status' | 'explainerId'>> = { playerIds: remainingPlayerIds };
    if (remainingPlayerIds.length === 0) fields.status = 'cancelled';
    else if (wasExplainer) fields.explainerId = remainingPlayerIds[0];
    batch.update(tableDoc.ref, fields);
  });

  playersSnap.docs.forEach((otherDoc) => {
    if (otherDoc.id === playerId) return;
    const other = otherDoc.data() as Player;
    const interests = { ...other.interests };
    let interestsChanged = false;
    const canExplain = new Set(other.canExplain);
    let canExplainChanged = false;
    const repeatGameIds = new Set(other.repeatGameIds ?? []);
    let repeatChanged = false;

    ownedGameIds.forEach((gid) => {
      const promoted = promotions.get(gid);
      if (promoted) {
        if (gid in interests) {
          const vote = interests[gid];
          delete interests[gid];
          if (vote && !(promoted.id in interests)) interests[promoted.id] = vote;
          interestsChanged = true;
        }
        if (canExplain.delete(gid)) { canExplain.add(promoted.id); canExplainChanged = true; }
        if (repeatGameIds.delete(gid)) { repeatGameIds.add(promoted.id); repeatChanged = true; }
      } else {
        if (gid in interests) { delete interests[gid]; interestsChanged = true; }
        if (canExplain.delete(gid)) canExplainChanged = true;
        if (repeatGameIds.delete(gid)) repeatChanged = true;
      }
    });

    if (interestsChanged || canExplainChanged || repeatChanged) {
      batch.update(otherDoc.ref, { interests, canExplain: [...canExplain], repeatGameIds: [...repeatGameIds] });
    }
  });

  await batch.commit();
}

/** Clears the paymentProofUrl on every player — called after the Cloudinary receipts themselves are deleted */
export async function clearPaymentProofs(eventCode: string): Promise<void> {
  const snap = await getDocs(collection(db, 'events', eventCode, 'players'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { paymentProofUrl: null }));
  await batch.commit();
}

export async function updatePlayerWishlist(
  eventCode: string,
  playerId: string,
  data: {
    interests: Player['interests']; canExplain: string[]; playedGameIds: string[];
    repeatGameIds: string[];
  }
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

/** Adds fresh voters to an already-open 'recommended' table's candidate pool (full updated list). */
export async function updateTableCandidates(eventCode: string, tableId: string, candidateIds: string[]): Promise<void> {
  await updateDoc(doc(db, 'events', eventCode, 'tables', tableId), { candidateIds });
}

/**
 * Owner posts a table for a game directly ("lo traigo, arranco a las 16hs") instead of the
 * algorithm assembling it from votes. Starts 'recommended' (unless the owner alone already meets
 * the game's minPlayers) with only the owner seated — other players join it directly via
 * joinPostedTable, no candidate/accept step, until it reaches the minimum and auto-promotes.
 */
export async function postTable(eventCode: string, table: Omit<Table, 'id'>): Promise<void> {
  await addDoc(collection(db, 'events', eventCode, 'tables'), table);
}

/**
 * Player responds to an algorithm-recommended table they're a candidate for. Accepting moves them
 * from candidateIds to playerIds, auto-promoting the table to 'confirmed' once the game's minimum
 * is reached. Rejecting moves them to rejectedIds so this exact table instance never re-offers
 * them again — their underlying vote is untouched, so a future regeneration can still propose a
 * different table for the same game. Runs as a transaction so two players responding at the same
 * instant can't both see the same stale candidate pool and overshoot maxPlayers.
 */
export async function respondToRecommendation(
  eventCode: string,
  tableId: string,
  playerId: string,
  accept: boolean,
  minPlayers: number,
  maxPlayers: number
): Promise<void> {
  const ref = doc(db, 'events', eventCode, 'tables', tableId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const table = snap.data() as Table;
    if (table.status !== 'recommended') return;
    const candidateIds = (table.candidateIds ?? []).filter((id) => id !== playerId);
    if (accept) {
      if (table.playerIds.includes(playerId) || table.playerIds.length >= maxPlayers) return;
      const playerIds = [...table.playerIds, playerId];
      tx.update(ref, { candidateIds, playerIds, ...(playerIds.length >= minPlayers && { status: 'confirmed' as const }) });
    } else {
      const rejectedIds = [...new Set([...(table.rejectedIds ?? []), playerId])];
      tx.update(ref, { candidateIds, rejectedIds });
    }
  });
}

/**
 * Adds a player directly to a table someone posted (postedByOwner) — joining is the player's own
 * explicit action, so there's no candidate/accept step like algorithm-recommended tables have.
 * Runs as a transaction so two players joining at the same instant can't both see "one seat left"
 * and overshoot maxPlayers. Auto-promotes the table to 'confirmed' once playerIds reaches the
 * game's minPlayers.
 */
export async function joinPostedTable(
  eventCode: string,
  tableId: string,
  playerId: string,
  minPlayers: number,
  maxPlayers: number
): Promise<void> {
  const ref = doc(db, 'events', eventCode, 'tables', tableId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const table = snap.data() as Table;
    if (table.status !== 'recommended' || table.playerIds.includes(playerId) || table.playerIds.length >= maxPlayers) return;
    const playerIds = [...table.playerIds, playerId];
    tx.update(ref, { playerIds, ...(playerIds.length >= minPlayers && { status: 'confirmed' as const }) });
  });
}

/**
 * Removes a player from a table they're already seated at, but only while it's still
 * 'recommended' (not yet confirmed) — used to resolve a time conflict when they choose a
 * different, overlapping table instead. No-ops if the table got confirmed in the meantime
 * (e.g. someone else took the last seat right as this player was deciding to leave).
 */
export async function leaveRecommendedTable(eventCode: string, tableId: string, playerId: string): Promise<void> {
  const ref = doc(db, 'events', eventCode, 'tables', tableId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const table = snap.data() as Table;
    if (table.status !== 'recommended') return;
    tx.update(ref, { playerIds: table.playerIds.filter((id) => id !== playerId) });
  });
}

/**
 * Leaves an owner-posted table, whether it's still waiting for players or already confirmed. A
 * confirmed table that drops back under the game's minimum returns to 'recommended' (waiting for
 * players again) instead of staying confirmed with too few people. The poster can't "leave" their
 * own table — it only makes sense for them to cancel it, which this does. Tables already underway
 * or finished are left alone.
 */
export async function leavePostedTable(
  eventCode: string,
  tableId: string,
  playerId: string,
  minPlayers: number
): Promise<void> {
  const ref = doc(db, 'events', eventCode, 'tables', tableId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const table = snap.data() as Table;
    if (table.status !== 'recommended' && table.status !== 'confirmed') return;
    if (table.explainerId === playerId) {
      tx.update(ref, { status: 'cancelled' as const });
      return;
    }
    if (!table.playerIds.includes(playerId)) return;
    const playerIds = table.playerIds.filter((id) => id !== playerId);
    tx.update(ref, {
      playerIds,
      ...(table.status === 'confirmed' && playerIds.length < minPlayers && { status: 'recommended' as const }),
    });
  });
}

/** Deletes a batch of tables — used to clear out stale "proposed" tables before a full regeneration */
export async function deleteTables(eventCode: string, tableIds: string[]): Promise<void> {
  if (tableIds.length === 0) return;
  const batch = writeBatch(db);
  tableIds.forEach((id) => batch.delete(doc(db, 'events', eventCode, 'tables', id)));
  await batch.commit();
}

/**
 * Same as deleteTables, but re-checks each table's status inside a transaction right before
 * deleting it — closing the race where an admin confirms a table at the same moment a
 * regeneration (triggered by another player's concurrent vote) decided it was stale and safe
 * to discard. Returns the ids that turned out to be confirmed in the meantime and were kept.
 */
export async function deleteStaleTables(eventCode: string, tableIds: string[]): Promise<string[]> {
  const keptConfirmed: string[] = [];
  await Promise.all(tableIds.map(async (id) => {
    const ref = doc(db, 'events', eventCode, 'tables', id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      if ((snap.data() as Table).status === 'confirmed') { keptConfirmed.push(id); return; }
      tx.delete(ref);
    });
  }));
  return keptConfirmed;
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

/**
 * Deletes only the players, games and tables created by the "Modo demo" seeder (isDemoData),
 * leaving real registrations — and anything tied to them — untouched. Used to reset before
 * reseeding fresh demo data without wiping the actual event.
 */
export async function resetEventData(eventCode: string): Promise<number> {
  const [playersSnap, gamesSnap, tablesSnap] = await Promise.all([
    getDocs(collection(db, 'events', eventCode, 'players')),
    getDocs(collection(db, 'events', eventCode, 'games')),
    getDocs(collection(db, 'events', eventCode, 'tables')),
  ]);
  const demoPlayerIds = new Set(
    playersSnap.docs.filter((d) => (d.data() as Player).isDemoData).map((d) => d.id)
  );
  const batch = writeBatch(db);
  playersSnap.docs.forEach((d) => { if (demoPlayerIds.has(d.id)) batch.delete(d.ref); });
  const deletedGameIds = new Set(
    gamesSnap.docs.filter((d) => demoPlayerIds.has((d.data() as Game).ownerPlayerId)).map((d) => d.id)
  );
  gamesSnap.docs.forEach((d) => {
    if (deletedGameIds.has(d.id)) { batch.delete(d.ref); return; }
    // A surviving real copy that was merged under a demo primary becomes standalone again.
    const groupId = (d.data() as Game).groupId;
    if (groupId && deletedGameIds.has(groupId)) batch.update(d.ref, { groupId: null });
  });
  tablesSnap.docs.forEach((d) => {
    const t = d.data() as Table;
    if ([...t.playerIds, t.explainerId].every((pid) => demoPlayerIds.has(pid))) batch.delete(d.ref);
  });
  await batch.commit();
  return demoPlayerIds.size;
}

/**
 * Bulk-creates fake players + their games + randomized wishlist votes in one batch, for
 * demos/testing. Also simulates the "postulated tables" flow (some owners post a table directly,
 * others join it) among the freshly-seeded players, so a demo run exercises that path too, not
 * just algorithm-recommended tables.
 */
export async function seedFakePlayers(eventCode: string, drafts: FakePlayerDraft[], event: MeepleEvent): Promise<void> {
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
        bggUrl: g.bggUrl,
        imageUrl: g.imageUrl,
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
  const interestsByPlayer: Record<string, InterestLevel>[] = [];

  drafts.forEach((draft, i) => {
    let ticketCode = generateTicketCodeCandidate();
    while (usedCodes.has(ticketCode)) ticketCode = generateTicketCodeCandidate();
    usedCodes.add(ticketCode);

    const ownGameIds = newGameIdsByPlayer[i];
    const canExplainIds = ownGameIds.filter((_, gi) => draft.games[gi].canExplain);
    const interests: Record<string, InterestLevel> = {};
    allGameIds.forEach((gid) => {
      interests[gid] = ownGameIds.includes(gid) ? randomOwnGameInterest() : randomInterest();
    });
    interestsByPlayer.push(interests);

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
      playedGameIds: [],
      repeatGameIds: [],
      paymentProofUrl: null,
      isDemoData: true,
    });
  });

  await batch.commit();

  const fakePlayersForTables: FakePlayerForTables[] = drafts.map((draft, i) => ({
    id: playerRefs[i].id,
    arrivalTime: draft.arrivalTime,
    departureTime: draft.departureTime,
    interests: interestsByPlayer[i],
  }));
  // Same rule as real posting: only someone who can explain the game may post a table for it.
  const fakeGamesForTables: FakeGameForTables[] = drafts.flatMap((draft, i) =>
    draft.games.flatMap((g, gi) => g.canExplain ? [{
      id: newGameIdsByPlayer[i][gi],
      name: g.name,
      ownerPlayerId: playerRefs[i].id,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      durationMinutes: g.durationMinutes,
    }] : [])
  );
  const postulatedDrafts = generateFakePostulatedTables(fakePlayersForTables, fakeGamesForTables, event);
  if (postulatedDrafts.length > 0) {
    const existingTables = await getTables(eventCode);
    let nextTableNumber = existingTables.length ? Math.max(...existingTables.map((t) => t.tableNumber)) + 1 : 1;
    const latestBatch = existingTables.length ? Math.max(...existingTables.map((t) => t.batchNumber)) : 1;
    const proposals: Omit<Table, 'id'>[] = postulatedDrafts.map((d) => ({
      gameId: d.gameId, gameName: d.gameName, startTime: d.startTime, endTime: d.endTime,
      explainerId: d.explainerId, playerIds: d.playerIds,
      status: d.status, postedByOwner: true, isManuallyEdited: false,
      batchNumber: latestBatch, tableNumber: nextTableNumber++,
    }));
    await saveProposedTables(eventCode, proposals);
  }

  // Demo games carry real BGG links, so duplicates merge by link exactly like real games do.
  await autoMergeDuplicates(eventCode, 'bggUrl');
}

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Tables assigned to a specific player (calculated, not stored) — includes still-pending recommended tables where they're the proposed explainer */
export function getPlayerTables(playerId: string, tables: Table[]): Table[] {
  return tables.filter(
    (t) => (t.playerIds.includes(playerId) || t.explainerId === playerId) && t.status !== 'cancelled'
  );
}
