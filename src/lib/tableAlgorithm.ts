import type { Player, Game, Table, TableStatus } from './types';
import { toMinutes, toTimeString, windowDuration } from './timeUtils';

interface TableProposal {
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string;
  explainerIsPlaying: boolean;
  playerIds: string[];
  status: TableStatus;
  isManuallyEdited: boolean;
  batchNumber: number;
  tableNumber: number;
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

// A drop-in teacher (not seated, not playing) only ties up ~30 min explaining before they're free again
export const TEACH_ONLY_MINUTES = 30;

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
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

function findEarliestWindow(
  players: Player[],
  durationMinutes: number,
  bufferMinutes: number,
  busyMap: Map<string, { start: string; end: string }[]>,
  physicalTables: number | null,
  occupiedTables: { startTime: string; endTime: string }[],
  sameGameWindows: { startTime: string; endTime: string }[],
  gameCopies: number,
  ownerWindows: { start: string; end: string }[]
): { start: string; end: string } | null {
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
    // The game can only be scheduled while at least one of its owners is actually at the venue
    // to have brought the physical copy — not necessarily seated at this specific table.
    if (ownerWindows.length > 0 && !ownerWindows.some((w) => toMinutes(w.start) <= startMin && startMin + durationMinutes <= toMinutes(w.end))) continue;
    return { start, end };
  }
  return null;
}

export function generateTables(
  players: Player[],
  games: Game[],
  existingTables: Table[],
  bufferMinutes: number,
  physicalTables: number | null,
  batchNumber: number,
  breaks: { start: string; end: string }[] = []
): TableProposal[] {
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

  const seatedByGame = new Map<string, Set<string>>();
  existingTables.forEach((t) => {
    if (t.status === 'cancelled') return;
    const seated = seatedByGame.get(t.gameId) ?? new Set<string>();
    t.playerIds.forEach((id) => seated.add(id));
    seatedByGame.set(t.gameId, seated);
  });

  // A game that only has enough demand left through repeat-flagged voters (no fresh voters
  // remain to justify it on its own) is treated as a last resort — every other viable game gets
  // tried first, so a repeat only fills someone's second table once nothing else fits for them.
  function isRepeatFallbackOnly(game: Game): boolean {
    const seated = seatedByGame.get(game.id);
    if (!seated || seated.size === 0) return false;
    const voters = players.filter((p) => !p.noAutoSchedule && (p.interests[game.id] === 'must' || p.interests[game.id] === 'casual'));
    const freshVoters = voters.filter((p) => !seated.has(p.id));
    return freshVoters.length < game.minPlayers;
  }

  const sorted = [...games].sort((a, b) => {
    const fallbackA = isRepeatFallbackOnly(a);
    const fallbackB = isRepeatFallbackOnly(b);
    if (fallbackA !== fallbackB) return fallbackA ? 1 : -1;
    const mustA = players.filter((p) => !p.noAutoSchedule && p.interests[a.id] === 'must').length;
    const mustB = players.filter((p) => !p.noAutoSchedule && p.interests[b.id] === 'must').length;
    const totA = mustA + players.filter((p) => !p.noAutoSchedule && p.interests[a.id] === 'casual').length;
    const totB = mustB + players.filter((p) => !p.noAutoSchedule && p.interests[b.id] === 'casual').length;
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
    if (mustB !== mustA) return mustB - mustA;
    const ratioA = totA > 0 ? mustA / totA : 0;
    const ratioB = totB > 0 ? mustB / totB : 0;
    if (ratioB !== ratioA) return ratioB - ratioA;
    return a.minPlayers - b.minPlayers;
  })
    // Secondary copies of a merged game (admin marked them as duplicates of a primary) never get
    // their own table-forming pass — the primary's pass below books up to `copies` concurrent
    // tables to cover all of them at once.
    .filter((g) => !g.groupId || g.groupId === g.id);

  const proposals: TableProposal[] = [];
  let tableNumber = existingTables.length
    ? Math.max(...existingTables.map((t) => t.tableNumber)) + 1
    : 1;

  for (const game of sorted) {
    // How many physical copies of this game exist — more than 1 only when the admin merged
    // duplicate entries together; lets that many tables of it run at the same time.
    const copies = games.filter((g) => (g.groupId ?? g.id) === game.id).length || 1;
    // The game can't be played before its owner has brought the physical copy to the venue, nor
    // after they've left with it — one window per copy/owner in the group (usually just one).
    const ownerWindows = games
      .filter((g) => (g.groupId ?? g.id) === game.id)
      .map((g) => players.find((p) => p.id === g.ownerPlayerId))
      .filter((p): p is Player => !!p)
      .map((owner) => ({ start: owner.arrivalTime, end: owner.departureTime }));
    // Players already seated at a table for this game only count again if they opted into a
    // replay — otherwise further tables for the same game are built from fresh voters only.
    // Loops so a single generation pass can seat all of them across as many tables as fit
    // (e.g. max 5 but 10 different "must" voters → two tables, different players, different times).
    const seated = new Set(seatedByGame.get(game.id) ?? []);
    // Every existing (non-cancelled) window this exact game is already booked into — further
    // tables for it can't overlap beyond the number of physical copies available.
    const gameWindows: { startTime: string; endTime: string }[] = existingTables
      .filter((t) => t.gameId === game.id && t.status !== 'cancelled')
      .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));
    while (true) {
      const eligibleForAnotherTable = (p: Player) => !seated.has(p.id) || (p.repeatGameIds ?? []).includes(game.id);
      const mustPlayers = players.filter((p) => !p.noAutoSchedule && p.interests[game.id] === 'must' && eligibleForAnotherTable(p));
      const casualPlayers = players.filter((p) => !p.noAutoSchedule && p.interests[game.id] === 'casual' && eligibleForAnotherTable(p));
      // Anyone who can explain but isn't getting seated (didn't vote must/casual, or got outranked
      // by higher-priority voters) can drop in just to teach for a short block, then leave — no
      // seat consumed, no full-session commitment. Least-committed volunteers are tried first so a
      // "must" voter's own seat isn't wasted on teaching duty if someone less invested can do it.
      const teachOnlyCandidates = players
        .filter((p) => !p.noAutoSchedule && p.canExplain.includes(game.id))
        .sort((a, b) => {
          const rank = (p: Player) => (p.interests[game.id] === 'must' ? 2 : p.interests[game.id] === 'casual' ? 1 : 0);
          return rank(a) - rank(b);
        });

      // "Me sumo" (casual) voters can help reach the minimum too, not just top up an already-
      // valid "Quiero" group — otherwise a game with e.g. 3 must + 1 casual (min 4) never gets a table.
      if (mustPlayers.length + casualPlayers.length < game.minPlayers) break;

      // Prioritizes "Quiero" voters for seats first, then within each tier whoever arrives
      // earliest — so a late arrival doesn't get pulled into a group ahead of someone who's been
      // free since the morning, which would needlessly push the whole table's start time back.
      const byFlexibility = [...mustPlayers, ...casualPlayers].sort((a, b) => {
        const mustA = a.interests[game.id] === 'must' ? 0 : 1;
        const mustB = b.interests[game.id] === 'must' ? 0 : 1;
        if (mustA !== mustB) return mustA - mustB;
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
        teachOnlyExplainer: Player | null;
      }

      // Builds a group by adding candidates one at a time in priority order, skipping anyone
      // who'd break the shared window for whoever's already locked in — instead of requiring the
      // whole top-N by priority to ALL be simultaneously free (one incompatible voter used to sink
      // every group containing them, even when swapping just that one person out would've worked).
      function buildGreedy(pool: Player[], seed: Player[], minSize: number, maxSize: number): { group: Player[]; window: { start: string; end: string } } | null {
        let group = [...seed];
        let window: { start: string; end: string } | null = null;
        if (group.length) {
          window = findEarliestWindow(group, game.durationMinutes, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);
          if (!window) return null;
        }
        for (const candidate of pool) {
          if (group.length >= maxSize) break;
          if (group.some((p) => p.id === candidate.id)) continue;
          const tentative = [...group, candidate];
          const found = findEarliestWindow(tentative, game.durationMinutes, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);
          if (found) {
            group = tentative;
            window = found;
          }
        }
        if (group.length < minSize || !window) return null;
        return { group, window };
      }

      // Tries seeding the greedy build with each candidate explainer in turn (playing-and-"Quiero"
      // first), keeping whichever seed grows the biggest compatible group; falls back to building
      // without an explainer requirement and pairing the result with a free drop-in teacher.
      function tryFindGroup(pool: Player[], minSize: number, maxSize: number): GroupResult | null {
        if (pool.length < minSize) return null;
        const explainerSeeds = [...pool.filter((p) => p.canExplain.includes(game.id))].sort((a, b) => {
          const rankA = a.interests[game.id] === 'must' ? 0 : 1;
          const rankB = b.interests[game.id] === 'must' ? 0 : 1;
          return rankA - rankB;
        });

        let best: GroupResult | null = null;
        for (const seed of explainerSeeds) {
          const built = buildGreedy(pool, [seed], minSize, maxSize);
          if (!built) continue;
          if (!best || built.group.length > best.group.length ||
            (built.group.length === best.group.length && toMinutes(built.window.start) < toMinutes(best.window.start))) {
            best = { group: built.group, window: built.window, teachOnlyExplainer: null };
          }
        }
        if (best) return best;

        // Nobody who'd take a seat can explain — build the group on availability alone, then see
        // if a drop-in teacher (no seat needed) is free during that window.
        const built = buildGreedy(pool, [], minSize, maxSize);
        if (!built) return null;
        const teachEnd = toTimeString(toMinutes(built.window.start) + TEACH_ONLY_MINUTES);
        const teacher = teachOnlyCandidates.find(
          (p) => built.group.every((c) => c.id !== p.id) && isAvailable(p, built.window.start, teachEnd, busyMap.get(p.id) ?? [], bufferMinutes)
        );
        return teacher ? { group: built.group, window: built.window, teachOnlyExplainer: teacher } : null;
      }

      // Prefers an all-"Quiero" group whenever there are enough must-voters to hit the minimum
      // on their own — "Me sumo" voters only get mixed in if that's not possible, even if a mixed
      // group would've found an earlier window (composition beats raw earliest-start here). This
      // holds even with multiple copies: two pure "Quiero" tables can still run in parallel if
      // enough distinct must-voters are free at an overlapping time, but a copy is never filled
      // with "Me sumo" voters just to avoid sitting idle while more hearts wait their turn later.
      const maxMustOnlySize = Math.min(game.maxPlayers, mustPlayers.length);
      const mustOnlyPool = byFlexibility.filter((p) => p.interests[game.id] === 'must');
      let best = maxMustOnlySize >= game.minPlayers ? tryFindGroup(mustOnlyPool, game.minPlayers, maxMustOnlySize) : null;
      if (!best) best = tryFindGroup(byFlexibility, game.minPlayers, game.maxPlayers);
      if (!best) break;
      const coreGroup = best.group;
      const window = best.window;
      const teachOnlyExplainer = best.teachOnlyExplainer;

      const group = [...coreGroup];
      for (const casual of casualPlayers) {
        if (group.length >= game.maxPlayers) break;
        if (group.some((p) => p.id === casual.id)) continue;
        if (teachOnlyExplainer && casual.id === teachOnlyExplainer.id) continue;
        if (isAvailable(casual, window.start, window.end, busyMap.get(casual.id) ?? [], bufferMinutes))
          group.push(casual);
      }

      // Among seated explainers, a "Quiero" beats a "Me sumo" — playing-and-explaining is the ideal,
      // ranked by how much they wanted to be there in the first place; window width only tiebreaks.
      const seatedExplainer = group
        .filter((p) => p.canExplain.includes(game.id))
        .sort((a, b) => {
          const rankA = a.interests[game.id] === 'must' ? 0 : 1;
          const rankB = b.interests[game.id] === 'must' ? 0 : 1;
          if (rankA !== rankB) return rankA - rankB;
          return windowDuration(b.arrivalTime, b.departureTime) - windowDuration(a.arrivalTime, a.departureTime);
        })[0];
      const explainer = seatedExplainer ?? teachOnlyExplainer!;
      const explainerIsPlaying = !!seatedExplainer;

      group.forEach((p) => {
        const bw = busyMap.get(p.id) ?? [];
        bw.push(window);
        busyMap.set(p.id, bw);
        seated.add(p.id);
      });

      // The drop-in teacher only blocks their own short teaching window — not the whole session,
      // and they're never added to `seated`, so they stay eligible to actually play this game later.
      if (!explainerIsPlaying && teachOnlyExplainer) {
        const teachEnd = toTimeString(toMinutes(window.start) + TEACH_ONLY_MINUTES);
        const bw = busyMap.get(teachOnlyExplainer.id) ?? [];
        bw.push({ start: window.start, end: teachEnd });
        busyMap.set(teachOnlyExplainer.id, bw);
      }

      proposals.push({
        gameId: game.id,
        gameName: game.name,
        startTime: window.start,
        endTime: window.end,
        explainerId: explainer.id,
        explainerIsPlaying,
        playerIds: group.map((p) => p.id),
        status: 'proposed',
        isManuallyEdited: false,
        batchNumber,
        tableNumber: tableNumber++,
      });
      occupiedTables.push({ startTime: window.start, endTime: window.end });
      gameWindows.push({ startTime: window.start, endTime: window.end });
    }
  }

  return proposals;
}

export interface NearMissGame {
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  missing: number; // how many more players it needs to reach minPlayers — always 1 for now
  playerNames: string[];
}

/**
 * Games that are exactly one player short of their minimum, but where the voters who ARE
 * committed already share a valid window (available, buffered, with a real explainer lined up,
 * and an actual free physical table at that time). Surfaced to walk-in/improvising players as
 * "join here and this table happens" suggestions — doesn't reserve anything, just reports it.
 */
export function findNearMissGames(
  players: Player[],
  games: Game[],
  existingTables: Table[],
  bufferMinutes: number,
  physicalTables: number | null,
  breaks: { start: string; end: string }[] = []
): NearMissGame[] {
  const busyMap = new Map<string, { start: string; end: string }[]>();
  players.forEach((p) => {
    const busy = getBusyWindows(p.id, existingTables);
    busy.push(...breaks);
    busyMap.set(p.id, busy);
  });
  const occupiedTables: { startTime: string; endTime: string }[] = existingTables
    .filter((t) => t.status !== 'cancelled')
    .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));
  const seatedByGame = new Map<string, Set<string>>();
  existingTables.forEach((t) => {
    if (t.status === 'cancelled') return;
    const seated = seatedByGame.get(t.gameId) ?? new Set<string>();
    t.playerIds.forEach((id) => seated.add(id));
    seatedByGame.set(t.gameId, seated);
  });

  const primaryGames = games.filter((g) => !g.groupId || g.groupId === g.id);
  const results: NearMissGame[] = [];

  for (const game of primaryGames) {
    const copies = games.filter((g) => (g.groupId ?? g.id) === game.id).length || 1;
    const ownerWindows = games
      .filter((g) => (g.groupId ?? g.id) === game.id)
      .map((g) => players.find((p) => p.id === g.ownerPlayerId))
      .filter((p): p is Player => !!p)
      .map((owner) => ({ start: owner.arrivalTime, end: owner.departureTime }));

    const seated = seatedByGame.get(game.id) ?? new Set<string>();
    const eligibleForAnotherTable = (p: Player) => !seated.has(p.id) || (p.repeatGameIds ?? []).includes(game.id);
    const mustPlayers = players.filter((p) => !p.noAutoSchedule && p.interests[game.id] === 'must' && eligibleForAnotherTable(p));
    const casualPlayers = players.filter((p) => !p.noAutoSchedule && p.interests[game.id] === 'casual' && eligibleForAnotherTable(p));
    const fullGroup = [...mustPlayers, ...casualPlayers];
    if (fullGroup.length < game.minPlayers - 1) continue;

    const gameWindows: { startTime: string; endTime: string }[] = existingTables
      .filter((t) => t.gameId === game.id && t.status !== 'cancelled')
      .map((t) => ({ startTime: t.startTime, endTime: t.endTime }));

    const tryWindow = (group: Player[]) =>
      group.length === 0 ? null : findEarliestWindow(group, game.durationMinutes, bufferMinutes, busyMap, physicalTables, occupiedTables, gameWindows, copies, ownerWindows);

    const hasExplainer = (group: Player[], window: { start: string; end: string }) => {
      if (group.some((p) => p.canExplain.includes(game.id))) return true;
      const teachEnd = toTimeString(toMinutes(window.start) + TEACH_ONLY_MINUTES);
      return players.some(
        (p) => !p.noAutoSchedule && p.canExplain.includes(game.id) && group.every((g) => g.id !== p.id) &&
          isAvailable(p, window.start, teachEnd, busyMap.get(p.id) ?? [], bufferMinutes)
      );
    };

    let found: { start: string; end: string } | null = null;
    let usedGroup: Player[] | null = null;

    if (fullGroup.length === game.minPlayers - 1) {
      // Exactly one player short — check if the group that IS committed already has a window.
      const w = tryWindow(fullGroup);
      if (w && hasExplainer(fullGroup, w)) { found = w; usedGroup = fullGroup; }
    } else if (fullGroup.length >= game.minPlayers) {
      // Enough total votes, but no table found yet (schedules didn't line up for everyone) — see
      // if dropping just the one most schedule-incompatible voter lets the rest fit; a walk-in
      // could fill that spot instead.
      for (let i = 0; i < fullGroup.length && !found; i++) {
        const reduced = fullGroup.filter((_, idx) => idx !== i);
        const w = tryWindow(reduced);
        if (w && hasExplainer(reduced, w)) { found = w; usedGroup = reduced; }
      }
    }

    if (!found || !usedGroup) continue;

    results.push({
      gameId: game.id, gameName: game.name, startTime: found.start, endTime: found.end,
      missing: Math.max(1, game.minPlayers - usedGroup.length), playerNames: usedGroup.map((p) => p.name),
    });
  }

  return results;
}

export interface TableFill {
  tableId: string;
  playerIds: string[]; // full updated roster (existing + newly added)
}

/**
 * Late joiners never get a seat by re-running generateTables alone, since it only ever proposes
 * brand-new sessions — it never revisits an already-proposed/confirmed table that still has open
 * seats. This fills those gaps first with any new must/casual voters who are free at that time.
 */
export function fillExistingTables(players: Player[], games: Game[], existingTables: Table[], bufferMinutes: number): TableFill[] {
  const gameMap = new Map(games.map((g) => [g.id, g]));
  const busyMap = new Map<string, { start: string; end: string }[]>();
  players.forEach((p) => busyMap.set(p.id, getBusyWindows(p.id, existingTables)));

  const fills: TableFill[] = [];
  const fillable = existingTables
    .filter((t) => t.status === 'proposed' || t.status === 'confirmed')
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  for (const table of fillable) {
    const game = gameMap.get(table.gameId);
    if (!game) continue;
    const seatsLeft = game.maxPlayers - table.playerIds.length;
    if (seatsLeft <= 0) continue;

    const candidates = players
      .filter((p) =>
        !p.noAutoSchedule &&
        !table.playerIds.includes(p.id) &&
        (p.interests[table.gameId] === 'must' || p.interests[table.gameId] === 'casual') &&
        isAvailable(p, table.startTime, table.endTime, busyMap.get(p.id) ?? [], bufferMinutes)
      )
      // 'must' voters get priority over 'casual' ones for the remaining seats
      .sort((a, b) => (a.interests[table.gameId] === 'must' ? 0 : 1) - (b.interests[table.gameId] === 'must' ? 0 : 1));

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
