'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, subscribeTables, getPlayers, getGames, getPlayerByTicketCode, updatePlayerWishlist, joinPostedTable,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { toMinutes, toTimeString } from '@/lib/timeUtils';
import { assignPhysicalSlots } from '@/lib/physicalSlots';
import { estimatedDuration } from '@/lib/tableAlgorithm';
import { BOARD_RETURN_KEY } from '@/lib/boardReturn';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import GameCover from '@/components/ui/GameCover';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Table, Player, ScheduledBreak, Game, GameComplexity, InterestLevel } from '@/lib/types';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Liviano',
  medium: 'Intermedio',
  heavy: 'Pesado',
};

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
  const [onlyMine, setOnlyMine] = useState(false);

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
    const stored = sessionStorage.getItem(BOARD_RETURN_KEY(code));
    if (stored) setBackHref(stored);
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
  const physicalSlotByTableId = useMemo(() => {
    const { assignments } = assignPhysicalSlots(scheduledTables, event?.settings.bufferMinutes ?? 0);
    return new Map(assignments.map((a) => [a.table.id, a.slot + 1]));
  }, [scheduledTables, event]);

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
          <div className='flex gap-2'>
            <button onClick={() => setView('grid')}
              className={'px-4 py-1.5 rounded-full text-sm font-medium border ' + (view === 'grid' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
              🗓️ Grilla
            </button>
            <button onClick={() => setView('cards')}
              className={'px-4 py-1.5 rounded-full text-sm font-medium border ' + (view === 'cards' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
              🎯 Tarjetas
            </button>
            {viewer && (
              <button onClick={() => setOnlyMine((v) => !v)}
                className={'px-4 py-1.5 rounded-full text-sm font-medium border ' + (onlyMine ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
                🎫 Solo mis mesas
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
            />
          ) : (
            <div className='space-y-10'>
              <BreaksBanner breaks={event?.settings.breaks ?? []} />
              {onlyMine && cardTables.length === 0 && (
                <p className='text-gray-500 text-sm py-6 text-center border border-gray-800 rounded-2xl'>Todavía no tenés mesas agendadas.</p>
              )}
              <TableSection
                title='🟢 En curso ahora' tables={active} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-green-600 bg-gray-800'
              />
              <TableSection
                title='🟡 Arrancan pronto' tables={soon} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-yellow-600 bg-gray-800'
              />
              <TableSection
                title='⚪ Más tarde' tables={upcoming} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
                cardClass='border-gray-700 bg-gray-800'
              />
              <TableSection
                title='✅ Finalizadas' tables={finished} playerMap={playerMap} gameMap={gameMap} slotMap={physicalSlotByTableId}
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
              <div className='space-y-2'>
                {recommendedTables.map((t) => {
                  const game = games.find((g) => g.id === t.gameId);
                  const minPlayers = game?.minPlayers ?? '?';
                  return (
                    <div key={t.id} className='border border-amber-700 rounded-xl p-3 bg-amber-950/20'>
                      <div className='flex justify-between items-start gap-2'>
                        <span className='flex items-center gap-2 min-w-0'>
                          <GameCover imageUrl={game?.imageUrl} />
                          <p className='font-semibold text-amber-300'>{t.gameName}</p>
                        </span>
                        <span className='text-xs text-amber-400 shrink-0'>{t.startTime}–{t.endTime}</span>
                      </div>
                      <p className='text-xs text-gray-400 mt-1'>
                        👥 {t.playerIds.length}/{minPlayers} aceptaron · {(t.candidateIds ?? []).length} candidatos en total
                      </p>
                      {viewer && (
                        viewer.interests[t.gameId] === 'yes' ? (
                          <p className='text-xs text-green-400 mt-2'>✅ Ya votaste que sí</p>
                        ) : (
                          <button onClick={() => handleQuickVoteYes(t.gameId)}
                            className='text-xs bg-amber-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-amber-700 mt-2'>
                            🙋 Unirme
                          </button>
                        )
                      )}
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
                  const minPlayers = game?.minPlayers ?? '?';
                  const maxPlayers = game?.maxPlayers;
                  const seatsLeft = maxPlayers != null ? maxPlayers - t.playerIds.length : null;
                  return (
                    <div key={t.id} className='border border-indigo-700 rounded-xl p-3 bg-indigo-950/20'>
                      <div className='flex justify-between items-start gap-2'>
                        <span className='flex items-center gap-2 min-w-0'>
                          <GameCover imageUrl={game?.imageUrl} />
                          <p className='font-semibold text-indigo-300'>{t.gameName}</p>
                        </span>
                        <span className='text-xs text-indigo-400 shrink-0'>{t.startTime}–{t.endTime}</span>
                      </div>
                      <p className='text-xs text-gray-400 mt-1'>
                        👥 {t.playerIds.length} anotado{t.playerIds.length === 1 ? '' : 's'}
                        {typeof minPlayers === 'number' && (minPlayers > t.playerIds.length
                          ? <> · faltan {minPlayers - t.playerIds.length} para confirmar</>
                          : <> · ya se confirma</>)}
                        {seatsLeft != null && <><br />🪑 {Math.max(0, seatsLeft)} lugar{seatsLeft === 1 ? '' : 'es'} libre{seatsLeft === 1 ? '' : 's'} de {maxPlayers}</>}
                      </p>
                      {game && (
                        <p className='text-xs text-gray-500 mt-0.5'>
                          {COMPLEXITY_LABEL[game.complexity]} · ~{estimatedDuration(game, game.maxPlayers)}min
                        </p>
                      )}
                      <p className='text-xs text-gray-500 mt-0.5'>
                        Lo trae {playerMap.get(t.explainerId)?.name ?? 'alguien'}
                      </p>
                      {viewer && (
                        t.playerIds.includes(viewer.id) ? (
                          <p className='text-xs text-green-400 mt-2'>✅ Ya estás anotado</p>
                        ) : seatsLeft != null && seatsLeft <= 0 ? null : (
                          <button onClick={() => handleQuickJoinPostulated(t)} disabled={joiningTableId === t.id}
                            className='text-xs bg-indigo-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-indigo-700 disabled:opacity-50 mt-2'>
                            {joiningTableId === t.id ? 'Sumando...' : '🙋 Unirme'}
                          </button>
                        )
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

      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
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
  startTime: string;
  endTime: string;
  gameName: string;
  seatsFilled?: number;
  seatsMax?: number;
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
}) {
  const activeTables = tables.filter((t) => t.status !== 'cancelled');
  // Slot assignment and time columns always come from the FULL schedule, so "Mesa #N" and the
  // header times stay identical to the unfiltered grid — filtering only hides other people's
  // entries, it never renumbers tables or reshapes the timeline.
  const { assignments, slotCount } = useMemo(() => assignPhysicalSlots(activeTables, bufferMinutes), [activeTables, bufferMinutes]);
  const buckets = useMemo(() => buildBuckets(activeTables, eventStartTime, eventEndTime), [activeTables, eventStartTime, eventEndTime]);
  const rowCount = Math.max(slotCount, physicalTables ?? 0, 1);
  const maxPlayersByGameId = useMemo(() => new Map(games.map((g) => [g.id, g.maxPlayers])), [games]);

  if (buckets.length === 0) return null;

  const hasOwnTables = !onlyPlayerId || activeTables.some((t) => t.playerIds.includes(onlyPlayerId));

  return (
    <section>
      <h2 className='text-xl font-semibold mb-3 text-gray-200'>🗓️ Grilla de mesas</h2>
      {!hasOwnTables ? (
        <p className='text-gray-500 text-sm py-6 text-center border border-gray-800 rounded-2xl'>Todavía no tenés mesas agendadas.</p>
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
                .filter((a) => a.slot === slotIdx && (!onlyPlayerId || a.table.playerIds.includes(onlyPlayerId)))
                .map((a) => a.table);
              if (onlyPlayerId && rowTables.length === 0) return null;
              const rowEntries: GridEntry[] = rowTables.map((t) => ({
                startTime: t.startTime, endTime: t.endTime, gameName: t.gameName,
                seatsFilled: t.playerIds.length, seatsMax: maxPlayersByGameId.get(t.gameId),
              }));
              const cells = buildRowCells(rowEntries, buckets, breaks);
              return (
                <tr key={slotIdx} className='border-t border-gray-800'>
                  <td className='p-2 font-semibold text-yellow-400 whitespace-nowrap sticky left-0 bg-gray-900'>
                    Mesa #{slotIdx + 1}
                  </td>
                  {cells.map((cell, ci) => (
                    <td key={ci} colSpan={cell.span}
                      className={'p-1.5 text-center align-middle border-l border-gray-800'}>
                      {cell.entry ? (
                        <div className={'rounded-lg border px-2 py-1.5 ' + colorForGame(cell.entry.gameName)}>
                          <div className='font-medium text-xs'>{cell.entry.gameName}</div>
                          <div className='text-[11px] opacity-75'>{cell.entry.startTime}–{cell.entry.endTime}</div>
                          {cell.entry.seatsMax != null && cell.entry.seatsFilled != null && cell.entry.seatsFilled < cell.entry.seatsMax && (
                            <div className='text-[11px] opacity-90'>🪑 quedan {cell.entry.seatsMax - cell.entry.seatsFilled}</div>
                          )}
                        </div>
                      ) : cell.breakLabel && (
                        <div className='rounded-lg border border-dashed border-gray-600 bg-gray-800/60 text-gray-400 px-2 py-1.5'>
                          <div className='text-xs'>🍽️ {cell.breakLabel}</div>
                        </div>
                      )}
                    </td>
                  ))}
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
  title, tables, playerMap, gameMap, slotMap, cardClass, dim,
}: {
  title: string;
  tables: Table[];
  playerMap: Map<string, Player>;
  gameMap: Map<string, Game>;
  slotMap: Map<string, number>;
  cardClass: string;
  dim?: boolean;
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
              <span className={'text-xs px-2 py-1 rounded-full font-medium ' + STATUS_COLOR[t.status]}>
                {STATUS_LABEL[t.status]}
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
          </div>
        ))}
      </div>
    </section>
  );
}
