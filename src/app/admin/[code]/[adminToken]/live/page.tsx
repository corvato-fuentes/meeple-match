'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, verifyAdminToken, subscribeTables, subscribePlayers, subscribeAllGames, seatPlayerAtTable, removePlayerFromTable,
  getTableById, updateTableStatus, updateTable, setTableEnd, createImprovisedTable,
} from '@/lib/firestore';
import { assignPhysicalSlots } from '@/lib/physicalSlots';
import { everSet } from '@/lib/tableStatusFilter';
import { freeTables, peopleWithoutTable, impliesPresence, liveTables, timeChangeClashes, addMinutes, liveAvailability, localDateString, type FreeTable } from '@/lib/liveBoard';
import { dayLabel } from '@/lib/shareTable';
import { toTimeString } from '@/lib/timeUtils';
import { FreeTablesSection, PeopleSection, MovePanel } from '@/components/admin/LiveSections';
import { TablesSection, type TableActions } from '@/components/admin/LiveTables';
import NewTablePanel, { type NewTableInput } from '@/components/admin/LiveNewTable';
import { sameGameOverlaps } from '@/lib/tableAlgorithm';
import type { Game, MeepleEvent, Player, Table } from '@/lib/types';

const CLOCK_MS = 30_000; // the clock the page works with
const PRESENCE_MS = 15_000; // arrivals other organizers confirm

/**
 * "En vivo": the organizers' screen for the day of the event. Which tables have a free place (right now, and in time order), who is
 * without a table (now, and soon), and quick ways to seat, move or take out people. Without a door check-in, presence is confirmed
 * here: with "Llegó", or by seating someone at a table that is running or about to start.
 */
export default function LivePage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [now, setNow] = useState<Date | null>(null);
  // "?hora=14:30" in the address pretends it is that time (to rehearse before the event, or to try the screen out of hours)
  const [simulated, setSimulated] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const listUrl = `/api/admin/checkin?code=${encodeURIComponent(code)}&adminToken=${encodeURIComponent(adminToken)}`;

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      setAuthorized(ok);
      if (ok) setEvent(await getEvent(code));
    });
  }, [code, adminToken]);

  useEffect(() => {
    if (!authorized) return;
    // Same list as "Gestionar mesas": cancelled ones count only if they had been set, so the numbering is the same
    const unsubs = [
      subscribeTables(code, (ts) => setTables(ts.filter((t) => t.status !== 'cancelled' || everSet(t)))),
      subscribePlayers(code, setPlayers),
      // Including the games made on the spot for improvised tables (the players never see those)
      subscribeAllGames(code, (gs) => setGames(gs.filter((g) => !g.deleted))),
    ];
    return () => unsubs.forEach((u) => u());
  }, [authorized, code]);

  useEffect(() => {
    queueMicrotask(() => {
      const m = /[?&]hora=(\d{1,2}):(\d{2})/.exec(window.location.search);
      setSimulated(m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null);
      setNow(new Date());
    });
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  // Who has been confirmed as there (the door's check-in and this screen write the same list)
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    const load = () => fetch(listUrl).then((res) => (res.ok ? res.json() : null))
      .then((json: { players?: { id: string; checkedInAt: number | null }[] } | null) => {
        if (!cancelled && json?.players) setPresent(new Set(json.players.filter((p) => p.checkedInAt != null).map((p) => p.id)));
      }).catch(() => {});
    void load();
    const timer = setInterval(load, PRESENCE_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [authorized, listUrl]);

  const nowMin = simulated ?? (now ? now.getHours() * 60 + now.getMinutes() : 0);
  const slotOf = useMemo(() => {
    const map = new Map<string, number>();
    if (event) assignPhysicalSlots(tables, event.settings.bufferMinutes).assignments.forEach((a) => map.set(a.table.id, a.slot + 1));
    return map;
  }, [tables, event]);

  const rows = useMemo(() => freeTables(tables, games, nowMin), [tables, games, nowMin]);
  const people = useMemo(() => peopleWithoutTable({ players, tables, rows, present, nowMin }), [players, tables, rows, present, nowMin]);

  const live = useMemo(() => liveTables(tables, present, nowMin), [tables, present, nowMin]);

  const label = (t: Table) => `${t.gameName}${slotOf.has(t.id) ? ` · Mesa #${slotOf.get(t.id)}` : ''}`;

  const markPresent = useCallback(async (playerId: string) => {
    setPresent((s) => new Set(s).add(playerId));
    try {
      const res = await fetch('/api/admin/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, adminToken, playerId }),
      });
      if (!res.ok) throw new Error('checkin');
    } catch {
      setPresent((s) => { const n = new Set(s); n.delete(playerId); return n; });
      throw new Error('checkin');
    }
  }, [code, adminToken]);

  async function run(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try { setNotice({ kind: 'ok', text: await work() }); }
    catch (e) { setNotice({ kind: 'error', text: e instanceof Error && e.message !== 'checkin' ? e.message : 'No se pudo completar. Probá de nuevo.' }); }
    finally { setBusy(false); }
  }

  const seat = (player: Player, row: FreeTable) => run(async () => {
    const ok = await seatPlayerAtTable(code, row.table.id, player.id, row.game.maxPlayers);
    if (!ok) throw new Error('Esa mesa se llenó o terminó justo ahora. Mirá la lista de nuevo.');
    // Seating someone at a table that is running or about to start means they are there
    if (impliesPresence(row)) await markPresent(player.id).catch(() => {});
    return `${player.name} quedó en ${label(row.table)}.`;
  });

  const arrived = (player: Player) => run(async () => { await markPresent(player.id); return `${player.name} está en el lugar.`; });

  const move = (player: Player, from: Table, to: FreeTable) => run(async () => {
    await removePlayerFromTable(code, from, player.id);
    const ok = await seatPlayerAtTable(code, to.table.id, player.id, to.game.maxPlayers);
    if (!ok) throw new Error(`Salió de ${label(from)}, pero ${label(to.table)} se llenó justo ahora. Quedó sin mesa: sentalo en otra.`);
    return `${player.name} pasó de ${label(from)} a ${label(to.table)}.`;
  });

  const remove = (player: Player, from: Table) => run(async () => {
    if (!window.confirm(`¿Sacar a ${player.name} de ${label(from)}? Si era quien la explicaba, otra persona de la mesa que sepa explicarla la toma; si no hay nadie, la mesa se deshace.`)) return 'No se cambió nada.';
    await removePlayerFromTable(code, from, player.id);
    return `${player.name} salió de ${label(from)}.`;
  });

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Alguien';
  const copiesOf = (t: Table) => games.filter((g) => (g.groupId ?? g.id) === t.gameId).length || 1;

  /** What would clash if the table ran [start, end) — as a sentence to ask about — or null when nothing does. */
  function clashText(table: Table, start: string, end: string): string | null {
    const c = timeChangeClashes({ table, start, end, tables, copies: copiesOf(table), bufferMinutes: event?.settings.bufferMinutes ?? 0 });
    const parts: string[] = [];
    if (c.people.length > 0) parts.push(c.people.map((x) => `${nameOf(x.playerId)} tiene otra mesa (${x.table.gameName} ${x.table.startTime}–${x.table.endTime})`).join('; '));
    if (c.sameGame.length > 0) parts.push(`no hay otra copia libre de ${table.gameName} para ese horario`);
    return parts.length > 0 ? parts.join('. ') : null;
  }

  // The tables' own states, in real time
  const startTable = (table: Table, presentIds: string[], absentIds: string[]) => run(async () => {
    await Promise.all(presentIds.map((id) => markPresent(id).catch(() => {})));
    // Each one leaves in turn, re-reading the table in between: taking out an explainer can change who explains it
    for (const id of absentIds) {
      const current = await getTableById(code, table.id);
      if (!current || current.status === 'cancelled') break;
      await removePlayerFromTable(code, current, id);
    }
    const after = await getTableById(code, table.id);
    if (!after || after.status === 'cancelled') return `${label(table)} se deshizo: no quedó nadie que pueda explicarla o jugarla.`;
    await updateTableStatus(code, table.id, 'in-progress', true);
    return `${label(table)} empezó con ${presentIds.length} persona${presentIds.length === 1 ? '' : 's'}.${absentIds.length > 0 ? ` Salieron ${absentIds.length}: su lugar quedó libre.` : ''}`;
  });

  const finishTable = (table: Table) => run(async () => {
    await updateTableStatus(code, table.id, 'completed', true);
    return `${label(table)} terminó.`;
  });

  const extendTable = (table: Table) => run(async () => {
    const end = addMinutes(table.endTime, 15);
    const clash = clashText(table, table.startTime, end);
    if (clash && !window.confirm(`Si sigue hasta las ${end}: ${clash}. ¿Alargarla igual?`)) return 'No se cambió nada.';
    await setTableEnd(code, table.id, end);
    return `${label(table)} ahora termina a las ${end}.`;
  });

  const waitTable = (table: Table) => run(async () => {
    const start = addMinutes(table.startTime, 15);
    const end = addMinutes(table.endTime, 15);
    const clash = clashText(table, start, end);
    if (clash && !window.confirm(`Si empieza a las ${start}: ${clash}. ¿Esperar igual?`)) return 'No se cambió nada.';
    await updateTable(code, table.id, { startTime: start, endTime: end, ...(table.explainEndTime ? { explainEndTime: addMinutes(table.explainEndTime, 15) } : {}) });
    return `${label(table)} se pasó a las ${start}.`;
  });

  const confirmTable = (table: Table) => run(async () => {
    await updateTableStatus(code, table.id, 'confirmed', true);
    return `${label(table)} quedó confirmada.`;
  });

  const cancelTable = (table: Table) => run(async () => {
    if (!window.confirm(`¿Marcar ${label(table)} como cancelada? Quienes estaban anotados quedan libres.`)) return 'No se cambió nada.';
    await updateTableStatus(code, table.id, 'cancelled', true);
    return `${label(table)} quedó cancelada.`;
  });

  /** A table that started in the room without being planned: written down as underway, with the people who sit marked as there. */
  const createTable = (input: NewTableInput) => run(async () => {
    if (input.game.id !== null) {
      const gameId = input.game.id;
      const busyCopies = sameGameOverlaps({
        tables, table: { id: '__new__', gameId }, start: input.startTime, end: input.endTime,
        bufferMinutes: event?.settings.bufferMinutes ?? 0, gameCopies: games.filter((g) => (g.groupId ?? g.id) === gameId).length || 1,
      });
      if (busyCopies.length > 0 && !window.confirm(`No hay otra copia libre de ${input.game.name} en ese horario (ya está en la mesa de las ${busyCopies[0].startTime}). ¿Anotarla igual?`)) return 'No se cambió nada.';
    }
    await createImprovisedTable(code, input);
    await Promise.all(input.playerIds.map((id) => markPresent(id).catch(() => {})));
    const n = input.playerIds.length + input.guestCount;
    return `Mesa de ${input.game.name} anotada, en curso hasta las ${input.endTime} (${n} personas).`;
  });

  const tableActions: TableActions = { onStart: startTable, onFinish: finishTable, onExtend: extendTable, onWait: waitTable, onConfirm: confirmTable, onCancel: cancelTable };

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event || !now) return <div className='p-8 text-center'>Cargando...</div>;

  // The screen has nothing to manage before the day of the event. "?hora=" is a rehearsal: it opens the screen whatever the day
  const availability = simulated != null ? 'today' : liveAvailability(event.date, localDateString(now));
  if (availability === 'before') {
    return (
      <main className='max-w-2xl mx-auto px-4 py-8 space-y-5'>
        <div className='flex items-center gap-3'>
          <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
          <h1 className='text-xl font-bold'>🔴 En vivo</h1>
        </div>
        <div className='border border-gray-700 rounded-2xl p-6 text-center space-y-2'>
          <p className='text-3xl' aria-hidden='true'>⏳</p>
          <p className='font-semibold'>Todavía no está activo</p>
          <p className='text-sm text-gray-400'>Esta pantalla se activa el día del evento ({dayLabel(event.date)}). Hasta entonces no hay mesas que gestionar en vivo.</p>
          <p className='text-sm text-gray-400'>Para armar o editar mesas con calma, usá <Link href={`/admin/${code}/${adminToken}/tables`} className='underline text-indigo-300'>Gestionar mesas</Link>.</p>
        </div>
      </main>
    );
  }
  const onEventDay = availability === 'today';
  const label24 = toTimeString(nowMin);
  const runningCount = rows.filter((r) => r.running).length;

  return (
    <main className='max-w-2xl mx-auto px-4 py-8 space-y-5'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex items-center gap-3 min-w-0'>
          <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
          <h1 className='text-xl font-bold truncate'>🔴 En vivo</h1>
        </div>
        <span className='text-sm text-gray-400 shrink-0' title='La hora de este dispositivo'>🕐 Ahora {label24}{simulated != null ? ' (simulado)' : ''}</span>
      </div>

      {!onEventDay && (
        <p className='text-xs text-amber-300 border border-amber-800 bg-amber-950/30 rounded-xl p-3'>
          El evento fue el {dayLabel(event.date)}. Lo que ves usa la hora de ahora, así que sirve para ordenar lo que haya quedado sin marcar, no para seguir el evento.
        </p>
      )}

      <div className='grid grid-cols-4 gap-2'>
        {[
          { n: live.filter((l) => l.attention).length, text: 'Piden atención' },
          { n: rows.length, text: 'Con lugar' },
          { n: people.now.length, text: 'Sin mesa' },
          { n: people.soon.length, text: 'Libres pronto' },
        ].map((k) => (
          <div key={k.text} className='border border-gray-700 rounded-xl p-2.5 text-center'>
            <p className='text-2xl font-bold'>{k.n}</p>
            <p className='text-[11px] text-gray-400'>{k.text}</p>
          </div>
        ))}
      </div>
      {runningCount > 0 && <p className='text-xs text-gray-500 -mt-2'>{runningCount} de esas mesas ya están jugándose: sumar a alguien es sumarlo a una partida en curso.</p>}

      {notice && (
        <p role='status' className={'text-sm rounded-xl p-3 border ' + (notice.kind === 'ok' ? 'border-green-800 bg-green-950/30 text-green-300' : 'border-red-800 bg-red-950/30 text-red-300')}>
          {notice.text}
        </p>
      )}

      <NewTablePanel games={games} players={players} tables={tables} present={present} nowMin={nowMin} busy={busy} onCreate={createTable} />
      <TablesSection items={live} nowMin={nowMin} players={players} games={games} label={label} actions={tableActions} busy={busy} />
      <MovePanel players={players} tables={tables} rows={rows} nowMin={nowMin} label={label} busy={busy} onMove={move} onRemove={remove} />
      <FreeTablesSection rows={rows} people={[...people.now, ...people.soon]} label={label} busy={busy} onSeat={seat} />
      <PeopleSection now={people.now} soon={people.soon} nowMin={nowMin} label={label} busy={busy} onSeat={seat} onArrived={arrived} />
      <p className='text-[11px] text-gray-600 text-center'>Se actualiza solo. Para armar o editar mesas con calma, usá <Link href={`/admin/${code}/${adminToken}/tables`} className='underline'>Gestionar mesas</Link>.</p>
    </main>
  );
}

