'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, subscribeTables, getPlayers } from '@/lib/firestore';
import { toMinutes, toTimeString } from '@/lib/timeUtils';
import { assignPhysicalSlots } from '@/lib/physicalSlots';
import type { MeepleEvent, Table, Player, ScheduledBreak } from '@/lib/types';

const STATUS_LABEL: Record<Table['status'], string> = {
  proposed: 'Propuesta',
  confirmed: 'Confirmada',
  'in-progress': 'En curso',
  completed: 'Finalizada',
  cancelled: 'Cancelada',
};

const STATUS_COLOR: Record<Table['status'], string> = {
  proposed: 'bg-yellow-900 text-yellow-300',
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
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<'grid' | 'cards'>('grid');
  // Defaults to the public event page; upgraded to the admin dashboard below if opened from there,
  // read from document.referrer (never put into this page's own URL) so a projected screen never shows the admin token.
  const [backHref, setBackHref] = useState(`/event/${code}`);

  useEffect(() => {
    getEvent(code).then(setEvent);
    getPlayers(code).then(setPlayers);
    const unsub = subscribeTables(code, (ts) =>
      setTables(ts.filter((t) => t.status !== 'cancelled'))
    );
    return unsub;
  }, [code]);

  useEffect(() => {
    if (!document.referrer) return;
    try {
      const match = new URL(document.referrer).pathname.match(/^\/admin\/([^/]+)\/([^/]+)\/?$/);
      if (match && match[1] === code) setBackHref(`/admin/${match[1]}/${match[2]}`);
    } catch {
      // ignore malformed referrer
    }
  }, [code]);

  // Live clock — also drives the now/soon/later grouping below
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowStr = toTimeString(nowMinutes);

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
    for (const t of tables) {
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
  }, [tables, nowMinutes, eventIsToday, eventIsPast, eventIsFuture]);

  // Physical table number (not the sequential session id) — same assignment used by the grid,
  // so "Mesa #N" means the same thing in both views.
  const physicalSlotByTableId = useMemo(() => {
    const { assignments } = assignPhysicalSlots(tables);
    return new Map(assignments.map((a) => [a.table.id, a.slot + 1]));
  }, [tables]);

  return (
    <main className='min-h-screen bg-gray-900 text-white p-6'>
      <div className='mb-8 flex items-start justify-between flex-wrap gap-4'>
        <div>
          <Link
            href={backHref}
            className='text-gray-400 hover:text-gray-200 text-sm inline-block mb-2'>
            ← Volver
          </Link>
          <h1 className='text-3xl font-bold'>{event?.name ?? 'MeepleMatch'}</h1>
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
          </div>

          {view === 'grid' ? (
            <ScheduleGrid
              tables={tables} nowMinutes={eventIsToday ? nowMinutes : null}
              physicalTables={event?.settings.physicalTables ?? null}
              eventStartTime={event?.startTime ?? null} eventEndTime={event?.endTime ?? null}
              breaks={event?.settings.breaks ?? []}
            />
          ) : (
            <div className='space-y-10'>
              <BreaksBanner breaks={event?.settings.breaks ?? []} />
              <TableSection
                title='🟢 En curso ahora' tables={active} playerMap={playerMap} slotMap={physicalSlotByTableId}
                cardClass='border-green-600 bg-gray-800'
              />
              <TableSection
                title='🟡 Arrancan pronto' tables={soon} playerMap={playerMap} slotMap={physicalSlotByTableId}
                cardClass='border-yellow-600 bg-gray-800'
              />
              <TableSection
                title='⚪ Más tarde' tables={upcoming} playerMap={playerMap} slotMap={physicalSlotByTableId}
                cardClass='border-gray-700 bg-gray-800'
              />
              <TableSection
                title='✅ Finalizadas' tables={finished} playerMap={playerMap} slotMap={physicalSlotByTableId}
                cardClass='border-gray-800 bg-gray-900' dim
              />
            </div>
          )}
        </div>
      )}
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
  for (let m = start; m < maxEnd; m += GRID_BUCKET_MIN) buckets.push(m);
  return buckets;
}

interface GridCell {
  span: number;
  table: Table | null;
  breakLabel?: string;
}

function buildRowCells(rowTables: Table[], buckets: number[], breaks: ScheduledBreak[]): GridCell[] {
  const findAt = (b: number) => rowTables.find((t) => toMinutes(t.startTime) <= b && toMinutes(t.endTime) > b) ?? null;
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
    cells.push({ span, table: t, breakLabel: br?.label });
    i += span;
  }
  return cells;
}

function ScheduleGrid({
  tables, nowMinutes, physicalTables, eventStartTime, eventEndTime, breaks,
}: {
  tables: Table[];
  nowMinutes: number | null;
  physicalTables: number | null;
  eventStartTime: string | null;
  eventEndTime: string | null;
  breaks: ScheduledBreak[];
}) {
  const activeTables = tables.filter((t) => t.status !== 'cancelled');
  const { assignments, slotCount } = useMemo(() => assignPhysicalSlots(activeTables), [activeTables]);
  const buckets = useMemo(() => buildBuckets(activeTables, eventStartTime, eventEndTime), [activeTables, eventStartTime, eventEndTime]);
  const rowCount = Math.max(slotCount, physicalTables ?? 0, 1);

  if (buckets.length === 0) return null;

  return (
    <section>
      <h2 className='text-xl font-semibold mb-3 text-gray-200'>🗓️ Grilla de mesas</h2>
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
              const rowTables = assignments.filter((a) => a.slot === slotIdx).map((a) => a.table);
              const cells = buildRowCells(rowTables, buckets, breaks);
              return (
                <tr key={slotIdx} className='border-t border-gray-800'>
                  <td className='p-2 font-semibold text-yellow-400 whitespace-nowrap sticky left-0 bg-gray-900'>
                    Mesa #{slotIdx + 1}
                  </td>
                  {cells.map((cell, ci) => (
                    <td key={ci} colSpan={cell.span}
                      className={'p-1.5 text-center align-middle border-l border-gray-800'}>
                      {cell.table ? (
                        <div className={'rounded-lg border px-2 py-1.5 ' + colorForGame(cell.table.gameName)}>
                          <div className='font-medium text-xs'>{cell.table.gameName}</div>
                          <div className='text-[11px] opacity-75'>{cell.table.startTime}–{cell.table.endTime}</div>
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
  title, tables, playerMap, slotMap, cardClass, dim,
}: {
  title: string;
  tables: Table[];
  playerMap: Map<string, Player>;
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
            <p className='text-xl font-semibold mb-1'>{t.gameName}</p>
            <p className='text-gray-400 text-sm mb-3'>{t.startTime} – {t.endTime}</p>
            <div className='space-y-1'>
              {t.playerIds.map((pid) => {
                const p = playerMap.get(pid);
                return (
                  <div key={pid} className='flex items-center gap-2 text-sm'>
                    <span className='text-gray-300'>{p?.name ?? pid}</span>
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
