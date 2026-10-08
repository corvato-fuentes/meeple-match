import type { Player, Game, Table } from './types';
import { toMinutes, toTimeString, windowDuration, roundUp5 } from './timeUtils';

interface TableProposal {
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string;
  playerIds: string[]; // always empty at creation — nobody has accepted a recommended table yet
  candidateIds: string[];
  rejectedIds: string[];
  status: 'recommended';
  isManuallyEdited: boolean;
  batchNumber: number;
  tableNumber: number;
}

export interface CandidateUpdate {
  tableId: string;
  candidateIds: string[]; // full updated list (existing + newly added)
}

export interface GenerateTablesResult {
  proposals: TableProposal[];
  candidateUpdates: CandidateUpdate[];
}

function getBusyWindows(playerId: string, tables: Table[]) {
  return tables
    .filter((t) => t.playerIds.includes(playerId) && t.status !== 'cancelled')
    .map((t) => ({ start: t.startTime, end: t.endTime }));
}

function isAvailable(
  player: Player,
  winStart: string,
  winEnd: string,
  busy: { start: string; end: string }[],
  bufferMinutes: number
): boolean {
  const ws = toMinutes(winStart);
  const we = toMinutes(winEnd);
  // Buffer applies right after arrival too — nobody sits down and starts playing the instant
  // they walk in, regardless of which candidate time slot this window came from.
  if (ws < toMinutes(player.arrivalTime) + bufferMinutes || we > toMinutes(player.departureTime)) return false;
  // A buffer gap is required on both sides — not just "no overlap" — so a player never goes
  // straight from one table into the next with zero time to stand up and walk over.
  return busy.every((bw) => toMinutes(bw.end) + bufferMinutes <= ws || we + bufferMinutes <= toMinutes(bw.start));
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
}

/**
 * The player's own table, if any, whose time window overlaps the given one — used to catch
 * scheduling conflicts (e.g. accepting a recommended table while already seated at a posted one
 * that overlaps) before writing the new commitment. Ignores cancelled tables and `excludeTableId`
 * (the table being joined/accepted itself, in case it's already reflected in the list).
 */
export function findConflictingTable(
  playerId: string,
  start: string,
  end: string,
  tables: Table[],
  excludeTableId?: string
): Table | null {
  return tables.find((t) =>
    t.id !== excludeTableId &&
    t.status !== 'cancelled' &&
    t.playerIds.includes(playerId) &&
    overlaps(t.startTime, t.endTime, start, end)
  ) ?? null;
}

/** How many of the given tables are physically occupying a seat during [start, end) */
function concurrentTableCount(occupied: { startTime: string; endTime: string }[], start: string, end: string): number {
  return occupied.filter((t) => overlaps(t.startTime, t.endTime, start, end)).length;
}

// Table start times are rounded up to this grid so schedules read as "10:30", not "10:39"
const ROUND_MIN = 15;

function roundUpToGrid(minutes: number): number {
  return Math.ceil(minutes / ROUND_MIN) * ROUND_MIN;
}

/**
 * A game's actual playing time depends on how many people are at the table, once the admin/owner
 * fills in per-player/setup/explanation minutes. Falls back to the flat `durationMinutes` when
 * none of those are set, so existing games with only a flat duration keep working unchanged.
 */
export function estimatedDuration(game: Game, playerCount: number): number {
  // Always rounded up to a multiple of 5 so every estimate reads "40min", never "38min".
  if (game.perPlayerMinutes == null && game.setupMinutes == null && game.explanationMinutes == null) {
    return roundUp5(game.durationMinutes);
  }
  return roundUp5((game.setupMinutes ?? 0) + (game.explanationMinutes ?? 0) + (game.perPlayerMinutes ?? 0) * playerCount);
}

/** The game's full min↔max duration span — shortest at minPlayers, longest at maxPlayers seated. */
export function estimatedDurationRange(game: Game): [number, number] {
  return [estimatedDuration(game, game.minPlayers), estimatedDuration(game, game.maxPlayers)];
}

function findEarliestWindow(
  players: Player[],
  game: Game,
  bufferMinutes: number,
  busyMap: Map<string, { start: string; end: string }[]>,
  physicalTables: number | null,
  occupiedTables: { startTime: string; endTime: string }[],
  sameGameWindows: { startTime: string; endTime: string }[],
  gameCopies: number,
  ownerWindows: { start: string; end: string; ownerId: string; lendable: boolean }[]
): { start: string; end: string } | null {
  // Recomputed from the size of THIS tentative group — every time the incremental group-builder
  // (buildGreedy) tries adding one more candidate, the required playing time grows accordingly.
  const durationMinutes = estimatedDuration(game, players.length);
  const candidates = new Set<number>();
  players.forEach((p) => {
    // Buffer applies after arrival too — nobody sits down and starts playing the instant they walk in
    candidates.add(roundUpToGrid(toMinutes(p.arrivalTime) + bufferMinutes));
    (busyMap.get(p.id) ?? []).forEach((bw) =>
      candidates.add(roundUpToGrid(toMinutes(bw.end) + bufferMinutes))
    );
  });
  if (physicalTables != null) {
    // A physical table only frees up once an occupying game finishes (+ buffer to reset it)
    occupiedTables.forEach((t) => candidates.add(roundUpToGrid(toMinutes(t.endTime) + bufferMinutes)));
  }
  // A copy of this exact game needs one of its own copies freed up too — up to gameCopies tables
  // of it can run at once (more than 1 only when the admin merged duplicate entries together).
  sameGameWindows.forEach((t) => candidates.add(roundUpToGrid(toMinutes(t.endTime) + bufferMinutes)));
  // Padding each existing window's end by the buffer means a copy freed up right at that instant
  // still counts as "in use" for a bit longer — blocking an immediate back-to-back reuse (same
  // box needs to be reset) while still allowing true parallel copies to overlap.
  const paddedSameGameWindows = sameGameWindows.map((t) => ({
    startTime: t.startTime,
    endTime: toTimeString(toMinutes(t.endTime) + bufferMinutes),
  }));
  // The physical copy can't be in play before its owner has actually brought it to the venue
  ownerWindows.forEach((w) => candidates.add(roundUpToGrid(toMinutes(w.start))));

  for (const startMin of Array.from(candidates).sort((a, b) => a - b)) {
    const start = toTimeString(startMin);
    const end = toTimeString(startMin + durationMinutes);
    if (!players.every((p) => isAvailable(p, start, end, busyMap.get(p.id) ?? [], bufferMinutes))) continue;
    if (physicalTables != null && concurrentTableCount(occupiedTables, start, end) >= physicalTables) continue;
    if (concurrentTableCount(paddedSameGameWindows, start, end) >= gameCopies) continue;
    // The game can only be scheduled while at least one of its owners is actually at the venue to
    // have brought the physical copy. If that owner didn't opt in to lend it out, they also need
    // to be one of the seated players — otherwise their copy can't leave their hands.
    if (ownerWindows.length > 0 && !ownerWindows.some((w) =>
      toMinutes(w.start) <= startMin && startMin + durationMinutes <= toMinutes(w.end) &&
      (w.lendable || players.some((p) => p.id === w.ownerId))
    )) continue;
    return { start, end };
  }
  return null;
}

/**
 * Builds the set of "recommended" tables the algorithm can offer right now, from every player's
 * simple 👍/👎 vote. A recommended table isn't real yet — it's a candidate pool + a fixed window;
 * players accept or reject individually (see respondToRecommendation in firestore.ts), and only
 * once enough have accepted does it become 'confirmed'.
 *
 * Two things can happen per game:
 * 1. An already-open recommended table (candidates still being gathered) gets NEW candidates
 *    added if a fresh voter fits its already-fixed window — this never changes an existing
 *    table's time once people have started responding to it.
 * 2. Voters not absorbed by any open table (none exists yet, or all are full) get grouped into
 *    brand new recommended table(s), same greedy window-search as before, just without any
 *    must/casual tiering now that there's only one vote level.
 */
export function generateTables(
  players: Player[],
  games: Game[],
  existingTables: Table[],
  bufferMinutes: number,
  physicalTables: number | null,
  batchNumber: number,
  breaks: { start: string; end: string }[] = []
): GenerateTablesResult {
  const busyMap = new Map<string, { start: string; end: string }[]>();
  players.forEach((p) => {
    const busy = getBusyWindows(p.id, existingTables);
    // Blocks every player during scheduled breaks so no table can be scheduled across them
    busy.push(...breaks);
    busyMap.set(p.id, busy);
  });
  const occupiedTables: { startTime: string; endTime: string }[] = existingTables
    .filter((t) => t.status !== 'cancelled')
    .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));

  // Everyone already offered a seat (candidate, accepted, or rejected) on ANY non-cancelled table
  // for a game — a fresh proposal never re-offers these people unless they opted into a repeat.
  const offeredByGame = new Map<string, Set<string>>();
  existingTables.forEach((t) => {
    if (t.status === 'cancelled') return;
    const offered = offeredByGame.get(t.gameId) ?? new Set<string>();
    t.playerIds.forEach((id) => offered.add(id));
    (t.candidateIds ?? []).forEach((id) => offered.add(id));
    (t.rejectedIds ?? []).forEach((id) => offered.add(id));
    offeredByGame.set(t.gameId, offered);
  });

  const proposals: TableProposal[] = [];
  const candidateUpdates: CandidateUpdate[] = [];

  // A game that only has enough demand left through repeat-flagged voters (no fresh voters
  // remain to justify it on its own) is treated as a last resort — every other viable game gets
  // tried first, so a repeat only fills someone's second table once nothing else fits for them.
  function isRepeatFallbackOnly(game: Game): boolean {
    const offered = offeredByGame.get(game.id);
    if (!offered || offered.size === 0) return false;
    const voters = players.filter((p) => p.interests[game.id] === 'yes');
    const freshVoters = voters.filter((p) => !offered.has(p.id));
    return freshVoters.length < game.minPlayers;
  }

  const sorted = [...games].sort((a, b) => {
    const fallbackA = isRepeatFallbackOnly(a);
    const fallbackB = isRepeatFallbackOnly(b);
    if (fallbackA !== fallbackB) return fallbackA ? 1 : -1;
    const totA = players.filter((p) => p.interests[a.id] === 'yes').length;
    const totB = players.filter((p) => p.interests[b.id] === 'yes').length;
    // A game with enough voters for only ONE table this pass (not even close to double its
    // minimum) has zero room to recover if it loses just one of them to another game's schedule —
    // it either happens now or never. A game with enough demand for several tables degrades
    // gracefully instead (just forms fewer of them), so it keeps competing on raw popularity
    // like before instead of being treated as equally "at risk".
    const singleShotA = totA < 2 * a.minPlayers;
    const singleShotB = totB < 2 * b.minPlayers;
    if (singleShotA !== singleShotB) return singleShotA ? -1 : 1;
    if (singleShotA && singleShotB) {
      const slackA = totA - a.minPlayers;
      const slackB = totB - b.minPlayers;
      if (slackA !== slackB) return slackA - slackB;
    }
    if (totB !== totA) return totB - totA;
    return a.minPlayers - b.minPlayers;
  })
    // Secondary copies of a merged game (admin marked them as duplicates of a primary) never get
    // their own table-forming pass — the primary's pass below books up to `copies` concurrent
    // tables to cover all of them at once.
    .filter((g) => !g.groupId || g.groupId === g.id);

  let tableNumber = existingTables.length
    ? Math.max(...existingTables.map((t) => t.tableNumber)) + 1
    : 1;

  for (const game of sorted) {
    // How many physical copies of this game exist — more than 1 only when the admin merged
    // duplicate entries together; lets that many tables of it run at the same time.
    const copies = games.filter((g) => (g.groupId ?? g.id) === game.id).length || 1;
    // The game can't be played before its owner has brought the physical copy to the venue, nor
    // after they've left with it — one window per copy/owner in the group (usually just one).
    // `lendable` carries whether that owner is OK with a table running without them seated.
    const ownerWindows = games
      .filter((g) => (g.groupId ?? g.id) === game.id)
      .map((g) => {
        const owner = players.find((p) => p.id === g.ownerPlayerId);
        return owner ? { start: owner.arrivalTime, end: owner.departureTime, ownerId: owner.id, lendable: !!g.lendable } : null;
      })
      .filter((w): w is { start: string; end: string; ownerId: string; lendable: boolean } => !!w);

    const offered = offeredByGame.get(game.id) ?? new Set<string>();
    // Every existing (non-cancelled) window this exact game is already booked into — further
    // tables for it can't overlap beyond the number of physical copies available.
    const gameWindows: { startTime: string; endTime: string }[] = existingTables
      .filter((t) => t.gameId === game.id && t.status !== 'cancelled')
      .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));

    // 1. Extend still-open recommended tables (algorithm-generated, not owner-posted) with any
    // fresh voter who fits the window already fixed for that table — never changes its time.
    const openTables = existingTables.filter(
      (t) => t.gameId === game.id && t.status === 'recommended' && !t.postedByOwner && t.playerIds.length < game.maxPlayers
    );
    for (const ot of openTables) {
      const known = new Set([...(ot.candidateIds ?? []), ...ot.playerIds, ...(ot.rejectedIds ?? [])]);
      const fresh = players.filter((p) =>
        p.interests[game.id] === 'yes' && !known.has(p.id) &&
        isAvailable(p, ot.startTime, ot.endTime, busyMap.get(p.id) ?? [], bufferMinutes)
      );
      if (fresh.length === 0) continue;
      candidateUpdates.push({ tableId: ot.id, candidateIds: [...(ot.candidateIds ?? []), ...fresh.map((p) => p.id)] });
      fresh.forEach((p) => offered.add(p.id));
    }

    // 2. Group the remaining fresh voters into brand-new recommended table(s).
    while (true) {
      const eligibleForAnotherTable = (p: Player) => !offered.has(p.id) || (p.repeatGameIds ?? []).includes(game.id);
      const interested = players.filter((p) => p.interests[game.id] === 'yes' && eligibleForAnotherTable(p));
      if (interested.length < game.minPlayers) break;

      // Whoever arrives earliest goes first — a late arrival shouldn't get pulled ahead of
      // someone who's been free since the morning, which would needlessly delay the table.
      const byFlexibility = [...interested].sort((a, b) => {
        const arrivalA = toMinutes(a.arrivalTime);
        const arrivalB = toMinutes(b.arrivalTime);
        if (arrivalA !== arrivalB) return arrivalA - arrivalB;
        const busyA = (busyMap.get(a.id) ?? []).length;
        const busyB = (busyMap.get(b.id) ?? []).length;
        if (busyA !== busyB) return busyA - busyB;
        return windowDuration(b.arrivalTime, b.departureTime) - windowDuration(a.arrivalTime, a.departureTime);
      });

      interface GroupResult {
        group: Player[];
        window: { start: string; end: string };
        explainer: Player;
      }

      // Builds a group by adding candidates one at a time in priority order, skipping anyone
      // who'd break the shared window for whoever's already locked in — instead of requiring the
      // whole top-N by priority to ALL be simultaneously free (one incompatible voter used to sink
      // every group containing them, even when swapping just that one person out would've worked).
      function buildGreedy(pool: Player[], seed: Player[], minSize: number, maxSize: number): { group: Player[]; window: { start: string; end: string } } | null {
        let group = [...seed];
        let window: { start: string; end: string } | null = null;
        if (group.length) {
          window = findEarliestWindow(group, game, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);
          if (!window) return null;
        }
        for (const candidate of pool) {
          if (group.length >= maxSize) break;
          if (group.some((p) => p.id === candidate.id)) continue;
          const tentative = [...group, candidate];
          const found = findEarliestWindow(tentative, game, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);
          if (found) {
            group = tentative;
            window = found;
          }
        }
        if (group.length < minSize || !window) return null;
        return { group, window };
      }

      // The explainer always sits at the table, so every group is seeded with someone who can
      // explain the game; keeps whichever seed grows the biggest compatible group.
      function tryFindGroup(pool: Player[], minSize: number, maxSize: number): GroupResult | null {
        if (pool.length < minSize) return null;
        const explainerSeeds = pool.filter((p) => p.canExplain.includes(game.id));

        let best: GroupResult | null = null;
        for (const seed of explainerSeeds) {
          const built = buildGreedy(pool, [seed], minSize, maxSize);
          if (!built) continue;
          if (!best || built.group.length > best.group.length ||
            (built.group.length === best.group.length && toMinutes(built.window.start) < toMinutes(best.window.start))) {
            best = { group: built.group, window: built.window, explainer: seed };
          }
        }
        return best;
      }

      const best = tryFindGroup(byFlexibility, game.minPlayers, game.maxPlayers);
      if (!best) break;
      const { group, window, explainer } = best;

      proposals.push({
        gameId: game.id,
        gameName: game.name,
        startTime: window.start,
        endTime: window.end,
        explainerId: explainer.id,
        playerIds: [],
        candidateIds: group.map((p) => p.id),
        rejectedIds: [],
        status: 'recommended',
        isManuallyEdited: false,
        batchNumber,
        tableNumber: tableNumber++,
      });
      occupiedTables.push({ startTime: window.start, endTime: window.end });
      gameWindows.push({ startTime: window.start, endTime: window.end });
      group.forEach((p) => offered.add(p.id));
    }
  }

  return { proposals, candidateUpdates };
}

export interface TableFill {
  tableId: string;
  playerIds: string[]; // full updated roster (existing + newly added)
}

/**
 * Late "yes" voters can directly join an already-CONFIRMED table with open seats — no accept
 * step needed since the table is already locked in. (Still-`recommended` tables instead grow
 * their candidate pool via generateTables, and need an explicit accept from each new voter.)
 */
export function fillExistingTables(players: Player[], games: Game[], existingTables: Table[], bufferMinutes: number): TableFill[] {
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const busyMap = new Map<string, { start: string; end: string }[]>();
  players.forEach((p) => busyMap.set(p.id, getBusyWindows(p.id, existingTables)));

  const fills: TableFill[] = [];
  const fillable = existingTables
    .filter((t) => t.status === 'confirmed')
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  for (const table of fillable) {
    const game = gameMap.get(table.gameId);
    if (!game) continue;
    const seatsLeft = game.maxPlayers - table.playerIds.length;
    if (seatsLeft <= 0) continue;

    const candidates = players
      .filter((p) =>
        !table.playerIds.includes(p.id) &&
        p.interests[table.gameId] === 'yes' &&
        isAvailable(p, table.startTime, table.endTime, busyMap.get(p.id) ?? [], bufferMinutes)
      )
      .sort((a, b) => toMinutes(a.arrivalTime) - toMinutes(b.arrivalTime));

    const added = candidates.slice(0, seatsLeft);
    if (added.length === 0) continue;

    fills.push({ tableId: table.id, playerIds: [...table.playerIds, ...added.map((p) => p.id)] });
    added.forEach((p) => {
      const bw = busyMap.get(p.id) ?? [];
      bw.push({ start: table.startTime, end: table.endTime });
      busyMap.set(p.id, bw);
    });
  }

  return fills;
}

export interface IdleGap {
  playerId: string;
  playerName: string;
  start: string;
  end: string;
}

/**
 * Reports the free windows each player has (arrival→departure minus any non-cancelled table
 * they're seated at and minus scheduled breaks like lunch) — surfaced to the admin so they can
 * spot and manually fix idle stretches the algorithm couldn't fill on its own.
 */
export function computeIdleGaps(
  players: Player[],
  tables: Table[],
  breaks: { start: string; end: string }[] = [],
  minGapMinutes = 60
): IdleGap[] {
  const gaps: IdleGap[] = [];
  const breakWindows = breaks.map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.end) }));
  for (const p of players) {
    const busy = [
      ...tables.filter((t) => t.playerIds.includes(p.id) && t.status !== 'cancelled')
        .map((t) => ({ start: toMinutes(t.startTime), end: toMinutes(t.endTime) })),
      ...breakWindows,
    ].sort((a, b) => a.start - b.start);

    let cursor = toMinutes(p.arrivalTime);
    const depart = toMinutes(p.departureTime);
    for (const b of busy) {
      if (b.start > cursor && b.start - cursor >= minGapMinutes) {
        gaps.push({ playerId: p.id, playerName: p.name, start: toTimeString(cursor), end: toTimeString(b.start) });
      }
      cursor = Math.max(cursor, b.end);
    }
    if (depart > cursor && depart - cursor >= minGapMinutes) {
      gaps.push({ playerId: p.id, playerName: p.name, start: toTimeString(cursor), end: toTimeString(depart) });
    }
  }
  return gaps;
}
