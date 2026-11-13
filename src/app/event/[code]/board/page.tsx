'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, subscribeTables, getPlayers, getGames, getPlayerByTicketCode, updatePlayerWishlist, joinPostedTable,
  respondToRecommendation, joinConfirmedTable, undoTableRejection,
} from '@/lib/firestore';
import {
  blockedMessage, freeSeatsOf, hasOpenSeat, hasWaitingSeat, missingToConfirm, seatOptionFor, type SeatOption,
} from '@/lib/freeSeats';
import { runTableGeneration } from '@/lib/tableGeneration';
import { toMinutes, toTimeString } from '@/lib/timeUtils';
import { assignPhysicalSlots, slotMapFor } from '@/lib/physicalSlots';
import WaitingTableInfo, { ActionButton, PostedWho, RecommendedWho } from '@/components/ui/WaitingTableInfo';
import { BOARD_RETURN_KEY } from '@/lib/boardReturn';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import GameCover from '@/components/ui/GameCover';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Table, Player, ScheduledBreak, Game, InterestLevel } from '@/lib/types';

const STATUS_LABEL: Record<Table['status'], string> = {
  recommended: 'Recomendada',
  confirmed: 'Confirmada',
  'in-progress': 'En curso',
  completed: 'Finalizada',
  cancelled: 'Cancelada',
};

const STATUS_COLOR: Record<Table['status'], string> = {
  recommended: 'bg-yellow-900 text-yellow-300',
  confirmed: 'bg-green-900 text-green-300',
  'in-progress': 'bg-blue-900 text-blue-300',
  completed: 'bg-gray-700 text-gray-300',
  cancelled: 'bg-red-900 text-red-300',
};

// Tables starting within this many minutes are flagged as "starting soon"
const SOON_THRESHOLD_MIN = 20;
// Matches the table-generation algorithm's 15-min rounding grid so slots line up exactly
const GRID_BUCKET_MIN = 15;

// Stable palette so the same game always gets the same color across renders/reloads
const GAME_COLORS = [
  'bg-blue-900 text-blue-200 border-blue-700',
  'bg-green-900 text-green-200 border-green-700',
  'bg-purple-900 text-purple-200 border-purple-700',
  'bg-pink-900 text-pink-200 border-pink-700',
  'bg-orange-900 text-orange-200 border-orange-700',
  'bg-teal-900 text-teal-200 border-teal-700',
  'bg-red-900 text-red-200 border-red-700',
  'bg-cyan-900 text-cyan-200 border-cyan-700',
  'bg-lime-900 text-lime-200 border-lime-700',
  'bg-fuchsia-900 text-fuchsia-200 border-fuchsia-700',
  'bg-amber-900 text-amber-200 border-amber-700',
  'bg-sky-900 text-sky-200 border-sky-700',
];

function colorForGame(gameName: string): string {
  let hash = 0;
  for (let i = 0; i < gameName.length; i++) hash = (hash * 31 + gameName.charCodeAt(i)) | 0;
  return GAME_COLORS[Math.abs(hash) % GAME_COLORS.length];
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type RecGroup = 'pending' | 'accepted' | 'other';
const REC_GROUP_LABEL: Record<RecGroup, string> = { pending: '🤔 Por aceptar', accepted: '✅ Ya acepté', other: 'Otras' };

export default function BoardPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<'grid' | 'cards'>('grid');
  // Defaults to the public event page; upgraded below (via sessionStorage) if opened from the
  // admin dashboard or a player's ticket page, so "← Volver" returns to where you actually came from.
  // Client-side <Link> navigation never updates document.referrer, so that can't be used here.
  const [backHref, setBackHref] = useState(`/event/${code}`);
  // Only set when the board is opened with a player's own ticket (e.g. from their /me page) —
  // enables the "Unirme" quick-join buttons below. A bare/public/TV view of the board has no
  // ticket and stays fully read-only.
  const [viewer, setViewer] = useState<Player | null>(null);
  const [knowledgePromptGameId, setKnowledgePromptGameId] = useState<string | null>(null);
  const [joiningTableId, setJoiningTableId] = useState<string | null>(null);
  const [respondingTableId, setRespondingTableId] = useState<string | null>(null);
  // The table whose Aceptar opened the overlap popup (so its "Rechazar" knows which table to decline)
  const [acceptingTable, setAcceptingTable] = useState<Table | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  // "Con lugar libre": shows only the confirmed tables that still have a place. Never on by itself.
  const [onlyFree, setOnlyFree] = useState(false);
  // The confirmed table whose free place is being looked at (from the grid's + button or its card), and the answer to taking it
  const [seatTableId, setSeatTableId] = useState<string | null>(null);
  const [takingSeat, setTakingSeat] = useState(false);
  const [seatNote, setSeatNote] = useState<string | null>(null);
  // Which table's people are being listed: just those who confirmed, or just those who are interested (not yet confirmed)
  const [viewing, setViewing] = useState<{ tableId: string; kind: 'confirmed' | 'interested' } | null>(null);
  const [recFilter, setRecFilter] = useState<RecGroup | null>(null); // null = show the first group that has tables

  useEffect(() => {
    getEvent(code).then(setEvent);
    getPlayers(code).then(setPlayers);
    getGames(code).then(setGames);
    const unsub = subscribeTables(code, (ts) =>
      setTables(ts.filter((t) => t.status !== 'cancelled'))
    );
    return unsub;
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      const stored = sessionStorage.getItem(BOARD_RETURN_KEY(code));
      if (!cancelled && stored) setBackHref(stored);
    });
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    const ticket = searchParams.get('ticket');
    if (!ticket) return;
    getPlayerByTicketCode(code, ticket).then(setViewer);
  }, [code, searchParams]);

  const { conflictPrompt, resolveScheduleConflict, handleConflictChoice } = useScheduleConflict(code, viewer, tables);

  // Live clock — also drives the now/soon/later grouping below
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const nameOfPlayer = (id: string) => (id === viewer?.id ? 'Vos' : playerMap.get(id)?.name ?? '?');
  const gameMap = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowStr = toTimeString(nowMinutes);

  // Only real (confirmed+) tables ever show up in the visual schedule — a 'recommended' table
  // is still waiting on confirmation, nothing to project on the board yet. That waiting state
  // splits in two: algorithm-recommended tables wait on candidates accepting/rejecting, while
  // owner-posted ones wait on enough players joining to reach the game's minimum.
  const scheduledTables = useMemo(() => tables.filter((t) => t.status !== 'recommended'), [tables]);
  const recommendedTables = useMemo(() => tables.filter((t) => t.status === 'recommended' && !t.postedByOwner), [tables]);
  const postulatedTables = useMemo(() => tables.filter((t) => t.status === 'recommended' && !!t.postedByOwner), [tables]);

  // The recommended tables, split by where the viewer stands: the ones waiting on their answer come first; the ones
  // they accepted, and everything else (rejected, not in the table, or not voted), are one chip away.
  const recGroups = useMemo(() => {
    const groups: Record<RecGroup, Table[]> = { pending: [], accepted: [], other: [] };
    for (const t of recommendedTables) {
      if (!viewer) groups.other.push(t);
      else if (t.playerIds.includes(viewer.id)) groups.accepted.push(t);
      // Offered it, or about to be (queued behind an explainer who hasn't confirmed): both are "mine to follow" first
      else if (([...(t.candidateIds ?? []), ...(t.queuedIds ?? [])]).includes(viewer.id) && !(t.rejectedIds ?? []).includes(viewer.id)) groups.pending.push(t);
      else groups.other.push(t);
    }
    return groups;
  }, [recommendedTables, viewer]);
  const activeRecGroup: RecGroup = recFilter && recGroups[recFilter].length > 0 ? recFilter
    : recGroups.pending.length > 0 ? 'pending' : recGroups.accepted.length > 0 ? 'accepted' : 'other';
  const visibleRecommended = viewer ? recGroups[activeRecGroup] : recommendedTables;

  // Drives the "Solo mis mesas" toggle for the cards view — the grid view filters separately
  // (via ScheduleGrid's onlyPlayerId) so its table numbering/timeline stay anchored to the full schedule.
  const cardTables = useMemo(
    () => onlyMine && viewer ? scheduledTables.filter((t) => t.playerIds.includes(viewer.id)) : scheduledTables,
    [scheduledTables, onlyMine, viewer]
  );

  // The schedule only reflects "now" when the event is actually happening today —
  // otherwise every table looked "finished" just because the clock was later in the day.
  const today = todayStr();
  const eventIsToday = event?.date === today;
  const eventIsPast = event ? event.date < today : false;
  const eventIsFuture = event ? event.date > today : false;
  const eventStarted = eventIsToday && nowMinutes >= toMinutes(event!.startTime || '00:00');

  // Free places: the confirmed tables that have not started and still have one, plus the ones still waiting for players (they
  // have room too) — and, for whoever has their ticket on, what they can do about each (answer the offer they already have, take
  // it themselves, vote so it gets offered, or why it is not for them).
  const tableStarted = (t: Table) => eventIsPast || (eventIsToday && nowMinutes >= toMinutes(t.startTime));
  const openIds = useMemo(
    () => new Set(scheduledTables.filter((t) => hasOpenSeat(t, gameMap.get(t.gameId), tableStarted(t))).map((t) => t.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduledTables, gameMap, eventIsPast, eventIsToday, nowMinutes]
  );
  const waitingOpen = useMemo(
    () => tables.filter((t) => hasWaitingSeat(t, gameMap.get(t.gameId), tableStarted(t))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, gameMap, eventIsPast, eventIsToday, nowMinutes]
  );
  const freeCount = openIds.size + waitingOpen.length;
  const takeable = useMemo(() => {
    const m = new Map<string, SeatOption>();
    for (const t of [...scheduledTables.filter((x) => openIds.has(x.id)), ...waitingOpen]) {
      const option = seatOptionFor({ viewer, table: t, game: gameMap.get(t.gameId), tables, started: false });
      if (option) m.set(t.id, option);
    }
    return m;
  }, [scheduledTables, tables, openIds, waitingOpen, viewer, gameMap]);

  const { active, soon, upcoming, finished } = useMemo(() => {
    const active: Table[] = [];
    const soon: Table[] = [];
    const upcoming: Table[] = [];
    const finished: Table[] = [];
    for (const t of cardTables) {
      const start = toMinutes(t.startTime);
      const end = toMinutes(t.endTime);
      if (t.status === 'completed' || eventIsPast || (eventIsToday && nowMinutes >= end)) {
        finished.push(t);
      } else if (eventIsFuture) {
        upcoming.push(t);
      } else if (eventIsToday && nowMinutes >= start) {
        active.push(t);
      } else if (eventIsToday && start - nowMinutes <= SOON_THRESHOLD_MIN) {
        soon.push(t);
      } else {
        upcoming.push(t);
      }
    }
    const byStart = (a: Table, b: Table) => toMinutes(a.startTime) - toMinutes(b.startTime);
    return {
      active: active.sort(byStart),
      soon: soon.sort(byStart),
      upcoming: upcoming.sort(byStart),
      finished: finished.sort(byStart),
    };
  }, [cardTables, nowMinutes, eventIsToday, eventIsPast, eventIsFuture]);

  // Physical table number (not the sequential session id) — same assignment used by the grid,
  // so "Mesa #N" means the same thing in both views.
  const physicalSlotByTableId = useMemo(
    () => slotMapFor(scheduledTables, event?.settings.bufferMinutes ?? 0),
    [scheduledTables, event]
  );

  function knowledgeLevelFor(gameId: string): KnowledgeLevel {
    if (!viewer) return 'never';
    if (viewer.canExplain.includes(gameId)) return 'explains';
    if ((viewer.playedGameIds ?? []).includes(gameId)) return 'knows';
    return 'never';
  }

  async function handleKnowledgeLevelChosen(gameId: string, level: KnowledgeLevel) {
    if (!viewer) return;
    const canExplain = level === 'explains'
      ? [...viewer.canExplain.filter((id) => id !== gameId), gameId]
      : viewer.canExplain.filter((id) => id !== gameId);
    const playedGameIds = level === 'knows'
      ? [...(viewer.playedGameIds ?? []).filter((id) => id !== gameId), gameId]
      : (viewer.playedGameIds ?? []).filter((id) => id !== gameId);
    setViewer({ ...viewer, canExplain, playedGameIds });
    setKnowledgePromptGameId(null);
    await updatePlayerWishlist(code, viewer.id, {
      interests: viewer.interests, canExplain, playedGameIds, repeatGameIds: viewer.repeatGameIds ?? [],
    });
  }

  function closeKnowledgePrompt() {
    setKnowledgePromptGameId(null);
  }

  // "Unirme" on a recommended card just votes yes — a future regeneration pass will actually seat
  // the viewer once it finds a shared window, same as voting from the wishlist normally would.
  async function handleQuickVoteYes(gameId: string) {
    if (!viewer || viewer.interests[gameId] === 'yes') return;
    const nextInterests = { ...viewer.interests, [gameId]: 'yes' as InterestLevel };
    setViewer({ ...viewer, interests: nextInterests });
    await updatePlayerWishlist(code, viewer.id, {
      interests: nextInterests, canExplain: viewer.canExplain, playedGameIds: viewer.playedGameIds ?? [],
      repeatGameIds: viewer.repeatGameIds ?? [],
    });
    if (event) runTableGeneration(code, event).catch(() => {});
    setKnowledgePromptGameId(gameId);
  }

  // Aceptar / Rechazar on a recommended card — the same answer as on the Mesas recomendadas page, so it can be given
  // right here. Accepting first checks the overlap popup, and re-checks the waiting tables afterwards (it takes the
  // viewer's time, so a table that was waiting for them to explain something else at that hour has to move on).
  async function handleRespondToRecommendation(t: Table, accept: boolean) {
    if (!viewer || respondingTableId) return;
    const game = games.find((g) => g.id === t.gameId);
    if (!game) return;
    if (accept) {
      setAcceptingTable(t);
      const ok = await resolveScheduleConflict(t);
      setAcceptingTable(null);
      if (!ok) return;
    }
    setRespondingTableId(t.id);
    try {
      await respondToRecommendation(code, t.id, viewer.id, accept, game.minPlayers, game.maxPlayers);
      if (accept && event) runTableGeneration(code, event).catch(() => {});
    } finally {
      setRespondingTableId(null);
    }
  }

  // "Rechazar" inside the overlap popup: closes it (cancelling the accept) and declines that table
  async function rejectFromConflictPopup() {
    const t = acceptingTable;
    await handleConflictChoice(false);
    if (t) await handleRespondToRecommendation(t, false);
  }

  // "Unirme" on a postulated card actually seats the viewer right away (same join flow as the
  // dedicated Mesas postuladas page), and also records a yes vote for consistency.
  async function handleQuickJoinPostulated(t: Table) {
    if (!viewer || joiningTableId) return;
    const game = games.find((g) => g.id === t.gameId);
    if (!game) return;
    if (!(await resolveScheduleConflict(t))) return;
    setJoiningTableId(t.id);
    try {
      await joinPostedTable(code, t.id, viewer.id, game.minPlayers, game.maxPlayers);
      const nextInterests = { ...viewer.interests, [t.gameId]: 'yes' as InterestLevel };
      setViewer({ ...viewer, interests: nextInterests });
      await updatePlayerWishlist(code, viewer.id, {
        interests: nextInterests, canExplain: viewer.canExplain, playedGameIds: viewer.playedGameIds ?? [],
        repeatGameIds: viewer.repeatGameIds ?? [],
      });
      setKnowledgePromptGameId(t.gameId);
    } finally {
      setJoiningTableId(null);
    }
  }

  // The "+" of a confirmed table with a free place (grid) or its "Sumarme" (card): opens the table with what the viewer can do
  function openSeat(tableId: string) {
    setSeatNote(null);
    setSeatTableId(tableId);
  }
  function closeSeat() {
    setSeatTableId(null);
    setSeatNote(null);
  }

  // Taking the place is the person's own explicit act: it seats them (after settling a clash with another table of theirs, as
  // everywhere else) and records their 👍 on the game. A transaction decides who gets the last place if two tap at once.
  async function handleTakeSeat(t: Table) {
    if (!viewer || takingSeat) return;
    const game = games.find((g) => g.id === t.gameId);
    if (!game) return;
    setSeatNote(null);
    if (!(await resolveScheduleConflict(t))) return;
    setTakingSeat(true);
    try {
      // A confirmed table is taken as it is; one its owner posted (still waiting for players) is joined like on Mesas postuladas
      const got = t.status === 'confirmed'
        ? await joinConfirmedTable(code, t.id, viewer.id, game.maxPlayers)
        : await joinPostedTable(code, t.id, viewer.id, game.minPlayers, game.maxPlayers);
      if (!got) { setSeatNote('Ese lugar se ocupó justo antes. Mirá si queda otro.'); return; }
      const nextInterests = { ...viewer.interests, [t.gameId]: 'yes' as InterestLevel };
      setViewer({ ...viewer, interests: nextInterests });
      await updatePlayerWishlist(code, viewer.id, {
        interests: nextInterests, canExplain: viewer.canExplain, playedGameIds: viewer.playedGameIds ?? [],
        repeatGameIds: viewer.repeatGameIds ?? [],
      });
      closeSeat();
      setKnowledgePromptGameId(t.gameId);
    } finally {
      setTakingSeat(false);
    }
  }

  // The place was already offered to the viewer: Aceptar / Rechazar, the same answer as on Mesas recomendadas
  async function answerSeatOffer(t: Table, accept: boolean) {
    await handleRespondToRecommendation(t, accept);
    closeSeat();
  }

  // A table the algorithm built that is still waiting: voting the game is how it gets offered
  async function voteFromSeat(t: Table) {
    await handleQuickVoteYes(t.gameId);
    closeSeat();
  }

  // A table the viewer declined: takes it off their declined list, so it can be offered (and shown) again. The dialog stays open
  // and updates to what they can do now.
  async function reconsiderTable(t: Table) {
    if (!viewer) return;
    await undoTableRejection(code, t.id, viewer.id);
  }

  const seatTable = seatTableId ? tables.find((t) => t.id === seatTableId) ?? null : null;
  // With the filter on, only the tables with a free place are listed (grid and cards)
  const freeOnly = (ts: Table[]) => (onlyFree ? ts.filter((t) => openIds.has(t.id)) : ts);

  return (
    <main className='min-h-screen bg-gray-900 text-white p-6'>
      <div className='mb-8 flex items-start justify-between flex-wrap gap-4'>
        <div>
          <Link
            href={backHref}
            className='text-gray-400 hover:text-gray-200 text-sm inline-block mb-2'>
            ← Volver
          </Link>
          <h1 className='text-3xl font-bold'>{event?.name ?? 'Meeple Loop'}</h1>
          <p className='text-gray-400'>
            {event?.date} · {event?.location} · Código: <span className='font-mono text-yellow-400'>{code}</span>
            {event?.mapUrl && (
              <> · <a href={event.mapUrl} target='_blank' rel='noopener noreferrer' className='text-indigo-400 hover:underline'>📍 mapa</a></>
            )}
          </p>
        </div>
        <div className='text-right'>
          {eventIsPast ? (
            <>
              <p className='text-4xl font-bold text-gray-500 leading-none'>Finalizado</p>
              <p className='text-gray-400 text-sm mt-1'>fue el {event?.date}</p>
            </>
          ) : eventStarted ? (
            <>
              <p className='text-6xl font-mono font-bold text-yellow-400 leading-none'>{nowStr}</p>
              <p className='text-gray-400 text-sm mt-1'>hora actual</p>
            </>
          ) : (
            <>
              <p className='text-6xl font-mono font-bold text-yellow-400 leading-none'>{event?.startTime ?? '--:--'}</p>
              <p className='text-gray-400 text-sm mt-1'>
                {eventIsFuture ? `arranca el ${event?.date}` : `arranca · son las ${nowStr}`}
              </p>
            </>
          )}
        </div>
      </div>

      {tables.length === 0 ? (
        <div className='text-center text-gray-500 mt-24 text-xl'>Esperando mesas...</div>
      ) : (
        <div className='space-y-6'>
          <div className='flex flex-wrap gap-2'>
            <button onClick={() => setView('grid')}
              className={'px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium border ' + (view === 'grid' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
              🗓️ Grilla
            </button>
            <button onClick={() => setView('cards')}
              className={'px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium border ' + (view === 'cards' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
              🎯 Tarjetas
            </button>
            {viewer && (
              <button onClick={() => setOnlyMine((v) => !v)}
                className={'px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium border ' + (onlyMine ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
                🎫 Solo mis mesas
              </button>
            )}
            {/* Shows up when some table — confirmed, or still waiting for players — has a place; never selected by itself */}
            {(freeCount > 0 || onlyFree) && (
              <button onClick={() => setOnlyFree((v) => !v)} aria-pressed={onlyFree}
                className={'px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium border ' + (onlyFree ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
                🪑 Con lugar libre ({freeCount})
              </button>
            )}
          </div>

          {view === 'grid' ? (
            <ScheduleGrid
              tables={scheduledTables} nowMinutes={eventIsToday ? nowMinutes : null}
              physicalTables={event?.settings.physicalTables ?? null}
              eventStartTime={event?.startTime ?? null} eventEndTime={event?.endTime ?? null}
              breaks={event?.settings.breaks ?? []} bufferMinutes={event?.settings.bufferMinutes ?? 0}
              games={games}
              onlyPlayerId={onlyMine ? viewer?.id ?? null : null}
              onlyIds={onlyFree ? openIds : null} waitingTables={onlyFree ? waitingOpen : undefined} takeable={takeable} onTake={openSeat}
            />
          ) : (
            <div className='space-y-10'>
              <BreaksBanner breaks={event?.settings.breaks ?? []} />
              {onlyMine && cardTables.length === 0 && (
                <p className='text-gray-500 text-sm py-6 text-center border border-gray-800 rounded-2xl'>Todavía no tenés mesas agendadas.</p>
              )}
              {onlyFree && freeOnly(cardTables).length === 0 && (
                <p className='text-gray-500 text-sm py-6 text-center border border-gray-800 rounded-2xl'>
                  {waitingOpen.length > 0
                    ? 'Ninguna mesa confirmada tiene lugar libre. Las que esperan jugadores están más abajo.'
                    : 'No quedan mesas con lugar libre.'}
                </p>
              )}
              <TableSection
                title='🟢 En curso ahora' tables={freeOnly(active)} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-green-600 bg-gray-800' openIds={openIds} takeable={takeable} onTake={openSeat}
              />
              <TableSection
                title='🟡 Arrancan pronto' tables={freeOnly(soon)} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-yellow-600 bg-gray-800' openIds={openIds} takeable={takeable} onTake={openSeat}
              />
              <TableSection
                title='⚪ Más tarde' tables={freeOnly(upcoming)} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-gray-700 bg-gray-800' openIds={openIds} takeable={takeable} onTake={openSeat}
              />
              <TableSection
                title='✅ Finalizadas' tables={freeOnly(finished)} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-gray-800 bg-gray-900' dim
              />
            </div>
          )}

          <div className='grid grid-cols-1 md:grid-cols-2 gap-6 items-start'>
          {recommendedTables.length > 0 && (
            <section>
              <h2 className='text-xl font-semibold mb-3 text-gray-200'>🟡 Mesas recomendadas — esperando confirmación</h2>
              <p className='text-sm text-gray-500 mb-3'>
                El algoritmo ya encontró un horario en común — falta que los candidatos acepten para agendarse.
              </p>
              {viewer && (
                <div className='flex flex-wrap gap-2 mb-3'>
                  {(Object.keys(REC_GROUP_LABEL) as RecGroup[]).map((g) => {
                    const on = g === activeRecGroup;
                    const count = recGroups[g].length;
                    return (
                      <button key={g} onClick={() => setRecFilter(g)} aria-pressed={on} disabled={count === 0}
                        className={`rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40 ${on ? 'bg-amber-600 border-amber-600 text-black' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
                        {REC_GROUP_LABEL[g]} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
              <div className='space-y-2'>
                {visibleRecommended.map((t) => {
                  const game = games.find((g) => g.id === t.gameId);
                  // Offered it, plus the people waiting in the queue until the explainer accepts
                  const interested = [...(t.candidateIds ?? []), ...(t.queuedIds ?? [])].filter((id) => !t.playerIds.includes(id)).length;
                  // What this means for the viewer is where they stand on THIS table — having voted yes on the game only
                  // makes them a candidate; they still have to accept the table. The note sits with the info lines and
                  // every card ends in one big button: the action you can take, or the state you are in.
                  const mine: { note?: string; button: ReactNode } | null = !viewer ? null
                    : t.explainerId === viewer.id && t.playerIds.includes(viewer.id)
                      ? { button: <ActionButton tone='done'>🎓 Confirmaste: vas a explicar y jugar</ActionButton> }
                    : t.playerIds.includes(viewer.id)
                      ? { button: <ActionButton tone='done'>✅ Ya confirmaste tu lugar en esta mesa</ActionButton> }
                    : (t.rejectedIds ?? []).includes(viewer.id)
                      ? { button: <ActionButton tone='muted'>🚫 Rechazaste esta mesa</ActionButton> }
                    : (t.candidateIds ?? []).includes(viewer.id)
                      ? {
                          note: t.awaitingExplainer ? '🎓 Podés explicar este juego — si lo explicás, jugás en la mesa' : undefined,
                          button: (
                            <div className='grid grid-cols-2 gap-2'>
                              <ActionButton tone='neutral' onClick={() => handleRespondToRecommendation(t, false)} disabled={respondingTableId === t.id}>
                                {t.awaitingExplainer ? '❌ No puedo explicarlo' : '❌ Rechazar'}
                              </ActionButton>
                              <ActionButton tone='amber' onClick={() => handleRespondToRecommendation(t, true)} disabled={respondingTableId === t.id}>
                                {respondingTableId === t.id ? 'Guardando...' : t.awaitingExplainer ? '✅ Explico y juego' : '✅ Aceptar'}
                              </ActionButton>
                            </div>
                          ),
                        }
                    : (t.queuedIds ?? []).includes(viewer.id)
                      ? { button: <ActionButton tone='muted'>⏳ Esperando que alguien confirme que la explica</ActionButton> }
                    : viewer.interests[t.gameId] === 'yes'
                      ? { button: <ActionButton tone='muted'>👍 Votaste que sí, pero no estás en esta mesa</ActionButton> }
                      : {
                          note: '🙋 No mostraste interés en este juego, pero estás a tiempo de unirte',
                          button: <ActionButton tone='amber' onClick={() => handleQuickVoteYes(t.gameId)}>🙋 Unirme</ActionButton>,
                        };
                  return (
                    <div key={t.id} className='border border-amber-700 rounded-xl p-3 bg-amber-950/20'>
                      <WaitingTableInfo t={t} game={game} accent='amber' interested={interested} seatWord='confirmados' note={mine?.note}
                        who={<RecommendedWho t={t} game={game} nameOf={nameOfPlayer} />}
                        onView={(kind) => setViewing({ tableId: t.id, kind })} />
                      {mine && <div className='mt-3'>{mine.button}</div>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {postulatedTables.length > 0 && (
            <section>
              <h2 className='text-xl font-semibold mb-3 text-gray-200'>📣 Mesas postuladas — esperando jugadores</h2>
              <p className='text-sm text-gray-500 mb-3'>
                Alguien ya propuso este horario para jugarlo — falta que se sumen jugadores hasta el mínimo para que se agende sola.
              </p>
              <div className='space-y-2'>
                {postulatedTables.map((t) => {
                  const game = games.find((g) => g.id === t.gameId);
                  const seatsLeft = game ? game.maxPlayers - t.playerIds.length : null;
                  return (
                    <div key={t.id} className='border border-indigo-700 rounded-xl p-3 bg-indigo-950/20'>
                      <WaitingTableInfo t={t} game={game} accent='indigo' interested={null} seatWord='anotados'
                        who={<PostedWho t={t} nameOf={nameOfPlayer}
                          explainerNames={t.playerIds.filter((id) => playerMap.get(id)?.canExplain.includes(t.gameId)).map(nameOfPlayer)} />}
                        onView={(kind) => setViewing({ tableId: t.id, kind })} />
                      {viewer && (
                        <div className='mt-3'>
                          {t.playerIds.includes(viewer.id) ? (
                            <ActionButton tone='done'>✅ Ya estás anotado</ActionButton>
                          ) : seatsLeft != null && seatsLeft <= 0 ? (
                            <ActionButton tone='muted'>🪑 La mesa está completa</ActionButton>
                          ) : (
                            <ActionButton tone='indigo' onClick={() => handleQuickJoinPostulated(t)} disabled={joiningTableId === t.id}>
                              {joiningTableId === t.id ? 'Sumando...' : '🙋 Unirme'}
                            </ActionButton>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          </div>
        </div>
      )}

      {knowledgePromptGameId && viewer && (() => {
        const game = games.find((g) => g.id === knowledgePromptGameId);
        if (!game) return null;
        return (
          <div className='fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50' onClick={closeKnowledgePrompt}>
            <div className='max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm'
              onClick={(e) => e.stopPropagation()}>
              <h3 className='font-semibold text-gray-100'>¿Qué tan bien conocés {game.name}?</h3>
              <KnowledgeLevelPicker value={knowledgeLevelFor(game.id)}
                onChange={(level) => handleKnowledgeLevelChosen(game.id, level)} />
              <button onClick={closeKnowledgePrompt} className='w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800'>
                Ahora no
              </button>
            </div>
          </div>
        );
      })()}

      {viewing && (() => {
        const t = tables.find((x) => x.id === viewing.tableId);
        if (!t) return null;
        const close = () => setViewing(null);
        const pending = [...(t.candidateIds ?? []), ...(t.queuedIds ?? [])].filter((id) => !t.playerIds.includes(id));
        const nameOf = (id: string) => (id === viewer?.id ? 'Vos' : playerMap.get(id)?.name ?? '?');
        const group = (title: string, ids: string[], empty: string, tag: string, tagClass: string) => (
          <div>
            <p className='text-xs font-semibold text-gray-300 mb-1'>{title} ({ids.length})</p>
            {ids.length === 0 ? (
              <p className='text-xs text-gray-500'>{empty}</p>
            ) : (
              <ul className='text-xs text-gray-400 space-y-1'>
                {ids.map((id) => (
                  <li key={id} className='flex items-center gap-2'>
                    <span className='truncate'>{nameOf(id)}</span>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${tagClass}`}>{tag}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
        return (
          <div className='fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50' onClick={close}>
            <div className='max-w-sm w-full max-h-[80vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm'
              onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className='font-semibold text-gray-100'>{t.gameName}</h3>
                <p className='text-xs text-gray-500'>{t.startTime}–{t.endTime}</p>
              </div>
              {viewing.kind === 'confirmed'
                ? group('🪑 Confirmados', t.playerIds, 'Nadie todavía.', 'confirmado', 'bg-green-900 text-green-300')
                : group('🤔 Interesados (sin confirmar)', pending, 'No quedan interesados pendientes.', 'interesado', 'bg-amber-900 text-amber-300')}
              <button onClick={close} className='w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800'>
                Cerrar
              </button>
            </div>
          </div>
        );
      })()}

      {seatTable && (() => {
        const t = seatTable;
        const game = gameMap.get(t.gameId);
        const option = takeable.get(t.id) ?? null;
        const left = freeSeatsOf(t, game);
        const waiting = t.status === 'recommended'; // still waiting for players, not on the schedule yet
        const missing = game ? missingToConfirm(t, game) : 0;
        return (
          <div className='fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50' onClick={closeSeat}>
            <div className='max-w-sm w-full max-h-[80vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm'
              onClick={(e) => e.stopPropagation()}>
              <div className='flex items-center gap-3'>
                <GameCover imageUrl={game?.imageUrl} size='md' />
                <div className='min-w-0'>
                  <h3 className='font-semibold text-gray-100'>{t.gameName}</h3>
                  <p className='text-xs text-gray-500'>
                    {waiting ? `${t.postedByOwner ? '📣 Postulada' : '🟡 Recomendada'} · esperando jugadores` : `Mesa #${physicalSlotByTableId.get(t.id) ?? '?'}`} · {t.startTime}–{t.endTime}
                  </p>
                  <p className='text-xs text-emerald-300'>
                    🪑 {left > 0 ? `quedan ${left}` : 'sin lugares libres'}
                    {waiting && missing > 0 && <span className='text-gray-400'> · faltan {missing} para confirmar</span>}
                  </p>
                </div>
              </div>
              <div className='text-xs text-gray-400 space-y-0.5'>
                {t.explainerId && !t.awaitingExplainer && <p>🎓 Explica: <span className='text-gray-200'>{nameOfPlayer(t.explainerId)}</span></p>}
                {t.awaitingExplainer && <p>🎓 Todavía espera que alguien confirme que la explica.</p>}
                {t.playerIds.length > 0 && <p>👥 {waiting ? 'Anotados' : 'Jugando'}: <span className='text-gray-200'>{t.playerIds.map(nameOfPlayer).join(', ')}</span></p>}
              </div>
              {option?.kind === 'offered' && (
                <>
                  <p className='text-xs text-amber-300'>
                    🙋 El algoritmo te ofreció este lugar.
                    {!waiting && ' La mesa ya está confirmada: los demás cuentan con vos si aceptás.'}
                  </p>
                  <div className='grid grid-cols-2 gap-2'>
                    <button onClick={() => answerSeatOffer(t, false)} disabled={respondingTableId === t.id}
                      className='border border-gray-700 rounded-lg py-2 text-gray-300 hover:bg-gray-800 disabled:opacity-50'>
                      {t.awaitingExplainer ? '❌ No puedo explicarlo' : '❌ Rechazar'}
                    </button>
                    <button onClick={() => answerSeatOffer(t, true)} disabled={respondingTableId === t.id}
                      className='bg-amber-600 text-white rounded-lg py-2 font-semibold hover:bg-amber-700 disabled:opacity-50'>
                      {respondingTableId === t.id ? 'Guardando...' : t.awaitingExplainer ? '✅ Explico y juego' : '✅ Aceptar'}
                    </button>
                  </div>
                </>
              )}
              {option?.kind === 'join' && (
                <>
                  <p className='text-xs text-gray-400'>
                    {waiting ? 'La mesa todavía espera jugadores: al sumarte ayudás a que se confirme.' : 'La mesa ya está confirmada: los demás cuentan con vos si te sumás.'}
                    {viewer?.interests[t.gameId] === 'yes' ? ' Ya votaste este juego.' : ' Queda tu voto 👍 en este juego.'}
                  </p>
                  <button onClick={() => handleTakeSeat(t)} disabled={takingSeat}
                    className='w-full bg-emerald-600 text-white rounded-lg py-2 font-semibold hover:bg-emerald-700 disabled:opacity-50'>
                    {takingSeat ? 'Sumándote...' : '🙋 Sumarme a esta mesa'}
                  </button>
                </>
              )}
              {option?.kind === 'vote' && (
                <>
                  <p className='text-xs text-gray-400'>
                    Esta mesa todavía espera jugadores y la armó el algoritmo con los votos. Si votás que sí a este juego, te la ofrece cuando le quede bien a todos.
                  </p>
                  <button onClick={() => voteFromSeat(t)}
                    className='w-full bg-indigo-600 text-white rounded-lg py-2 font-semibold hover:bg-indigo-700'>
                    👍 Quiero jugarlo
                  </button>
                </>
              )}
              {option?.kind === 'blocked' && (
                <>
                  <p className='text-xs text-gray-300'>ℹ️ {blockedMessage(option.reason, t)}</p>
                  {option.reason.kind === 'rejected' && (
                    <button onClick={() => reconsiderTable(t)}
                      className='w-full border border-indigo-700 text-indigo-300 rounded-lg py-2 hover:bg-indigo-950/40'>
                      🔄 Volver a considerarla
                    </button>
                  )}
                </>
              )}
              {option === null && (
                <p className='text-xs text-gray-500'>
                  {!viewer ? 'Para sumarte, entrá desde tu ticket.' : 'Esta mesa ya no tiene lugar.'}
                </p>
              )}
              {seatNote && <p className='text-xs text-red-400'>{seatNote}</p>}
              <button onClick={closeSeat} className='w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800'>
                Cerrar
              </button>
            </div>
          </div>
        );
      })()}

      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} onReject={rejectFromConflictPopup} />
    </main>
  );
}

function buildBuckets(tables: Table[], eventStartTime: string | null, eventEndTime: string | null): number[] {
  let minStart: number;
  let maxEnd: number;
  if (eventStartTime && eventEndTime) {
    minStart = toMinutes(eventStartTime);
    maxEnd = toMinutes(eventEndTime);
  } else if (tables.length > 0) {
    minStart = Math.min(...tables.map((t) => toMinutes(t.startTime)));
    maxEnd = Math.max(...tables.map((t) => toMinutes(t.endTime)));
  } else {
    return [];
  }
  // Tables can run past the event's nominal end time — extend the grid to cover them
  if (tables.length > 0) maxEnd = Math.max(maxEnd, ...tables.map((t) => toMinutes(t.endTime)));
  const start = Math.floor(minStart / GRID_BUCKET_MIN) * GRID_BUCKET_MIN;
  const buckets: number[] = [];
  // Includes one trailing bucket exactly at maxEnd (rendered empty, no table can start there) so
  // the grid's rightmost header shows the real closing time instead of stopping one slot short.
  for (let m = start; m <= maxEnd; m += GRID_BUCKET_MIN) buckets.push(m);
  return buckets;
}

interface GridEntry {
  tableId: string;
  startTime: string;
  endTime: string;
  gameName: string;
  seatsFilled?: number;
  seatsMax?: number;
  /** Set for a table still waiting for players (drawn dashed, in the "En espera" rows): who proposed it. */
  waiting?: 'posted' | 'recommended';
  /** How many more it needs to be confirmed (waiting tables). */
  missing?: number;
  /** What the viewer can do about this table's free place, when there is something (shows the small button in the corner). */
  take?: SeatOption;
}

/** How the small button of a free place looks: green/amber/indigo "+" when there is something to do, a grey "i" when there is not. */
function seatLook(o: SeatOption, t: { gameName: string; startTime: string; endTime: string }): { glyph: string; color: string; title: string; label: string } {
  switch (o.kind) {
    case 'offered': return { glyph: '+', color: 'bg-amber-500 hover:bg-amber-400', title: 'Te ofrecieron este lugar', label: `Te ofrecieron un lugar en ${t.gameName}` };
    case 'join': return { glyph: '+', color: 'bg-emerald-600 hover:bg-emerald-500', title: 'Sumarme a esta mesa', label: `Sumarme a ${t.gameName}` };
    case 'vote': return { glyph: '+', color: 'bg-indigo-600 hover:bg-indigo-500', title: 'Votar para que te la ofrezcan', label: `Votar ${t.gameName}` };
    case 'blocked': return { glyph: 'i', color: 'bg-gray-600 hover:bg-gray-500', title: blockedMessage(o.reason, t), label: `Por qué no puedo sumarme a ${t.gameName}` };
  }
}

const NO_TABLES: Table[] = [];

/** Tables that wait for players, laid out in as few rows as they fit in without overlapping. */
function assignLanes(tables: Table[]): Table[][] {
  const lanes: Table[][] = [];
  for (const t of [...tables].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))) {
    const lane = lanes.find((l) => toMinutes(l[l.length - 1].endTime) <= toMinutes(t.startTime));
    if (lane) lane.push(t); else lanes.push([t]);
  }
  return lanes;
}

interface GridCell {
  span: number;
  entry: GridEntry | null;
  breakLabel?: string;
}

function buildRowCells(rowEntries: GridEntry[], buckets: number[], breaks: ScheduledBreak[]): GridCell[] {
  const findAt = (b: number) => rowEntries.find((t) => toMinutes(t.startTime) <= b && toMinutes(t.endTime) > b) ?? null;
  const findBreakAt = (b: number) => breaks.find((br) => toMinutes(br.start) <= b && toMinutes(br.end) > b) ?? null;
  const cells: GridCell[] = [];
  let i = 0;
  while (i < buckets.length) {
    const t = findAt(buckets[i]);
    const br = t ? null : findBreakAt(buckets[i]);
    let span = 1;
    while (i + span < buckets.length) {
      const nextT = findAt(buckets[i + span]);
      const nextBr = nextT ? null : findBreakAt(buckets[i + span]);
      if (nextT !== t || (br?.label ?? null) !== (nextBr?.label ?? null)) break;
      span++;
    }
    cells.push({ span, entry: t, breakLabel: br?.label });
    i += span;
  }
  return cells;
}

function ScheduleGrid({
  tables, nowMinutes, physicalTables, eventStartTime, eventEndTime, breaks, bufferMinutes, games, onlyPlayerId,
  onlyIds, waitingTables, takeable, onTake,
}: {
  tables: Table[];
  nowMinutes: number | null;
  physicalTables: number | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  breaks: ScheduledBreak[];
  bufferMinutes: number;
  games: Game[];
  onlyPlayerId?: string | null;
  /** When set, only these tables are drawn (the "Con lugar libre" filter); the numbering and timeline stay those of the full schedule. */
  onlyIds?: Set<string> | null;
  /** Tables still waiting for players, drawn dashed in extra "En espera" rows under the others (they are not on the schedule yet, so
   *  they never change its numbering). Only given with the "Con lugar libre" filter on. */
  waitingTables?: Table[];
  /** What the viewer can do about the free place of a table: the small button in its corner. */
  takeable?: Map<string, SeatOption>;
  onTake?: (tableId: string) => void;
}) {
  const activeTables = tables.filter((t) => t.status !== 'cancelled');
  const waiting = waitingTables ?? NO_TABLES;
  // Slot assignment and time columns always come from the FULL schedule, so "Mesa #N" and the
  // header times stay identical to the unfiltered grid — filtering only hides other people's
  // entries, it never renumbers tables or reshapes the timeline.
  const { assignments, slotCount } = useMemo(() => assignPhysicalSlots(activeTables, bufferMinutes), [activeTables, bufferMinutes]);
  // The waiting tables only widen the time columns (a table can run past the closing time)
  const buckets = useMemo(() => buildBuckets([...activeTables, ...waiting], eventStartTime, eventEndTime), [activeTables, waiting, eventStartTime, eventEndTime]);
  const rowCount = Math.max(slotCount, physicalTables ?? 0, 1);
  const maxPlayersByGameId = useMemo(() => new Map(games.map((g) => [g.id, g.maxPlayers])), [games]);
  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const lanes = useMemo(() => assignLanes(waiting), [waiting]);

  if (buckets.length === 0) return null;

  const hasOwnTables = !onlyPlayerId || activeTables.some((t) => t.playerIds.includes(onlyPlayerId));
  const noneToShow = !hasOwnTables ? 'Todavía no tenés mesas agendadas.'
    : onlyIds && waiting.length === 0 && !activeTables.some((t) => onlyIds.has(t.id)) ? 'No quedan mesas con lugar libre.' : null;

  const renderCell = (cell: GridCell, ci: number) => (
    <td key={ci} colSpan={cell.span} className={'p-1.5 text-center align-middle border-l border-gray-800'}>
      {cell.entry ? (
        <div className={'relative rounded-lg border px-2 py-1.5 ' + colorForGame(cell.entry.gameName) + (cell.entry.waiting ? ' border-dashed opacity-90' : '')}>
          <div className='font-medium text-xs'>{cell.entry.gameName}</div>
          <div className='text-[11px] opacity-75'>{cell.entry.startTime}–{cell.entry.endTime}</div>
          {cell.entry.waiting && (
            <div className='text-[11px] opacity-90'>
              {cell.entry.waiting === 'posted' ? '📣 Postulada' : '🟡 Recomendada'}
              {cell.entry.seatsFilled != null && cell.entry.seatsMax != null && ` · ${cell.entry.seatsFilled}/${cell.entry.seatsMax}`}
            </div>
          )}
          {cell.entry.waiting && cell.entry.missing != null && cell.entry.missing > 0 && (
            <div className='text-[11px] opacity-90'>faltan {cell.entry.missing} para confirmar</div>
          )}
          {!cell.entry.waiting && cell.entry.seatsMax != null && cell.entry.seatsFilled != null && cell.entry.seatsFilled < cell.entry.seatsMax && (
            <div className='text-[11px] opacity-90'>🪑 quedan {cell.entry.seatsMax - cell.entry.seatsFilled}</div>
          )}
          {/* A small button in the corner (it takes no room from the text): the place can be taken, was offered, or says why it can't */}
          {cell.entry.take && onTake && (() => {
            const look = seatLook(cell.entry.take, cell.entry);
            return (
              <button onClick={() => onTake(cell.entry!.tableId)} aria-label={look.label} title={look.title}
                className={'absolute -top-2 -right-2 w-6 h-6 rounded-full text-white text-sm font-bold leading-none shadow ring-2 ring-gray-900 ' + look.color}>
                {look.glyph}
              </button>
            );
          })()}
        </div>
      ) : cell.breakLabel && (
        <div className='rounded-lg border border-dashed border-gray-600 bg-gray-800/60 text-gray-400 px-2 py-1.5'>
          <div className='text-xs'>🍽️ {cell.breakLabel}</div>
        </div>
      )}
    </td>
  );

  return (
    <section>
      <h2 className='text-xl font-semibold mb-3 text-gray-200'>🗓️ Grilla de mesas</h2>
      {noneToShow ? (
        <p className='text-gray-500 text-sm py-6 text-center border border-gray-800 rounded-2xl'>{noneToShow}</p>
      ) : (
      <div className='overflow-x-auto border border-gray-700 rounded-2xl'>
        <table className='w-full text-sm border-collapse min-w-max'>
          <thead>
            <tr>
              <th className='text-left p-2 text-gray-400 font-medium sticky left-0 bg-gray-900 z-10'>Mesa</th>
              {buckets.map((b) => {
                const isNowCol = nowMinutes != null && nowMinutes >= b && nowMinutes < b + GRID_BUCKET_MIN;
                return (
                  <th key={b} className={'p-2 font-normal whitespace-nowrap text-xs border-l border-gray-800 ' + (isNowCol ? 'text-yellow-400 bg-gray-800' : 'text-gray-500')}>
                    {toTimeString(b)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, slotIdx) => {
              const rowTables = assignments
                .filter((a) => a.slot === slotIdx && (!onlyPlayerId || a.table.playerIds.includes(onlyPlayerId)) && (!onlyIds || onlyIds.has(a.table.id)))
                .map((a) => a.table);
              if ((onlyPlayerId || onlyIds) && rowTables.length === 0) return null;
              const rowEntries: GridEntry[] = rowTables.map((t) => ({
                tableId: t.id, startTime: t.startTime, endTime: t.endTime, gameName: t.gameName,
                seatsFilled: t.playerIds.length, seatsMax: maxPlayersByGameId.get(t.gameId), take: takeable?.get(t.id),
              }));
              const cells = buildRowCells(rowEntries, buckets, breaks);
              return (
                <tr key={slotIdx} className='border-t border-gray-800'>
                  <td className='p-2 font-semibold text-yellow-400 whitespace-nowrap sticky left-0 bg-gray-900'>
                    Mesa #{slotIdx + 1}
                  </td>
                  {cells.map(renderCell)}
                </tr>
              );
            })}
            {/* Tables still waiting for players (only with the "Con lugar libre" filter): dashed, in rows of their own */}
            {lanes.map((lane, li) => {
              const entries: GridEntry[] = lane.map((t) => {
                const game = gameById.get(t.gameId);
                return {
                  tableId: t.id, startTime: t.startTime, endTime: t.endTime, gameName: t.gameName,
                  seatsFilled: t.playerIds.length, seatsMax: game?.maxPlayers, take: takeable?.get(t.id),
                  waiting: t.postedByOwner ? 'posted' : 'recommended', missing: game ? missingToConfirm(t, game) : undefined,
                };
              });
              return (
                <tr key={`w${li}`} className='border-t border-gray-800'>
                  <td className='p-2 text-xs font-medium text-gray-400 whitespace-nowrap sticky left-0 bg-gray-900'>⏳ En espera</td>
                  {buildRowCells(entries, buckets, []).map(renderCell)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function BreaksBanner({ breaks }: { breaks: ScheduledBreak[] }) {
  if (breaks.length === 0) return null;
  return (
    <div className='flex flex-wrap gap-2'>
      {breaks.map((b, i) => (
        <span key={i} className='text-sm border border-dashed border-gray-600 text-gray-400 rounded-full px-3 py-1'>
          🍽️ {b.label}: {b.start}–{b.end}
        </span>
      ))}
    </div>
  );
}

function TableSection({
  title, tables, playerMap, gameMap, slotMap, cardClass, dim, openIds, takeable, onTake,
}: {
  title: string;
  tables: Table[];
  playerMap: Map<string, Player>;
  gameMap: Map<string, Game>;
  slotMap: Map<string, number>;
  cardClass: string;
  dim?: boolean;
  /** Confirmed tables that still have a place: they say how many are left. */
  openIds?: Set<string>;
  /** What the viewer can do about the free place of each (take it, answer the offer, vote, or why not): its button. */
  takeable?: Map<string, SeatOption>;
  onTake?: (tableId: string) => void;
}) {
  if (tables.length === 0) return null;
  return (
    <section>
      <h2 className='text-xl font-semibold mb-3 text-gray-200'>
        {title} <span className='text-gray-500 text-base font-normal'>({tables.length})</span>
      </h2>
      <div className={'grid gap-4 md:grid-cols-2 lg:grid-cols-3' + (dim ? ' opacity-50' : '')}>
        {tables.map((t) => (
          <div key={t.id} className={`rounded-2xl p-5 border-2 ${cardClass}`}>
            <div className='flex justify-between items-start mb-3'>
              <span className='text-2xl font-bold text-yellow-400'>Mesa #{slotMap.get(t.id) ?? '?'}</span>
              {/* A table its owner posted that is still waiting for players reads "Postulada", not "Recomendada" */}
              <span className={'text-xs px-2 py-1 rounded-full font-medium ' + (t.status === 'recommended' && t.postedByOwner ? 'bg-purple-900 text-purple-300' : STATUS_COLOR[t.status])}>
                {t.status === 'recommended' && t.postedByOwner ? 'Postulada' : STATUS_LABEL[t.status]}
              </span>
            </div>
            <div className='flex items-center gap-3 mb-3'>
              <GameCover imageUrl={gameMap.get(t.gameId)?.imageUrl} size='md' />
              <div className='min-w-0'>
                <p className='text-xl font-semibold mb-0.5'>{t.gameName}</p>
                <p className='text-gray-400 text-sm'>{t.startTime} – {t.endTime}</p>
              </div>
            </div>
            <div className='space-y-1'>
              {t.playerIds.map((pid) => {
                const p = playerMap.get(pid);
                const vote = p?.interests[t.gameId];
                const voteIcon = vote === 'yes' ? '👍 ' : '';
                return (
                  <div key={pid} className='flex items-center gap-2 text-sm'>
                    <span className='text-gray-300'>{voteIcon}{p?.name ?? pid}</span>
                    {pid === t.explainerId && (
                      <span className='text-xs bg-purple-900 text-purple-300 px-1.5 rounded'>explica</span>
                    )}
                  </div>
                );
              })}
            </div>
            {openIds?.has(t.id) && (
              <div className='mt-3 flex items-center justify-between gap-2'>
                <span className='text-xs text-emerald-300'>🪑 quedan {freeSeatsOf(t, gameMap.get(t.gameId))}</span>
                {takeable?.get(t.id) && onTake && (() => {
                  const o = takeable.get(t.id)!;
                  const style = o.kind === 'offered' ? 'bg-amber-600 hover:bg-amber-700 text-white'
                    : o.kind === 'join' ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : o.kind === 'vote' ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    : 'border border-gray-600 text-gray-300 hover:bg-gray-700';
                  const text = o.kind === 'offered' ? '🙋 Te ofrecieron este lugar' : o.kind === 'join' ? '🙋 Sumarme'
                    : o.kind === 'vote' ? '👍 Votar para que te la ofrezcan' : 'ℹ️ Por qué no puedo sumarme';
                  return <button onClick={() => onTake(t.id)} className={'rounded-lg px-3 py-1 text-xs font-semibold ' + style}>{text}</button>;
                })()}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
