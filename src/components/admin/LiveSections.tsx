'use client';
import { useState } from 'react';
import { destinationsFor, tablesOf, type FreePerson, type FreeTable } from '@/lib/liveBoard';
import { toTimeString } from '@/lib/timeUtils';
import type { Player, Table } from '@/lib/types';

/** How a table reads in the live lists: its game, the physical table number of the schedule, and when. */
export interface TableLabel { (t: Table): string }

type Option = FreeTable & { votedYes: boolean };

/** One button to put a person at a table: the game, the physical table, the hour, and whether they voted for it. */
function SeatButton({ option, label, onSeat, busy }: { option: Option; label: string; onSeat: () => void; busy: boolean }) {
  return (
    <button onClick={onSeat} disabled={busy}
      className={'text-xs rounded-lg border px-2.5 py-1.5 text-left disabled:opacity-50 ' + (option.votedYes ? 'border-green-700 bg-green-950/40 text-green-200 hover:bg-green-950' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
      {option.votedYes ? '👍 ' : ''}Sumar a {label}
    </button>
  );
}

/** Tables with a free place, running ones first. Each can be filled with someone who is free and fits. */
export function FreeTablesSection({ rows, people, label, onSeat, busy }: {
  rows: FreeTable[]; people: FreePerson[]; label: TableLabel; busy: boolean;
  onSeat: (player: Player, row: FreeTable) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section className='space-y-2'>
      <h2 className='font-semibold flex items-center gap-2'>🪑 Lugares libres <span className='text-sm font-normal text-gray-500'>({rows.length})</span></h2>
      {rows.some((r) => r.waiting) && <p className='text-xs text-gray-500'>«Sin confirmar» es una mesa que el sistema propuso y todavía no llegó al mínimo de gente que aceptó: se puede sumar gente igual, pero todavía no es seguro que se juegue.</p>}
      {rows.length === 0 && <p className='text-sm text-gray-500 border border-gray-800 rounded-xl p-3'>No hay mesas con lugar libre por ahora.</p>}
      {rows.map((r) => {
        const fits = people.filter((p) => p.options.some((o) => o.table.id === r.table.id));
        const open = openId === r.table.id;
        return (
          <div key={r.table.id} className='border border-gray-700 rounded-xl p-3 bg-gray-800/50 space-y-2'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0'>
                <p className='font-medium leading-snug'>{label(r.table)}</p>
                <p className='text-xs text-gray-400'>{r.table.startTime}–{r.table.endTime} · {r.taken} de {r.game.maxPlayers} · {r.free === 1 ? 'falta 1' : `faltan ${r.free}`}</p>
              </div>
              <div className='flex flex-col items-end gap-1 shrink-0'>
                <span className={'text-xs rounded-full px-2 py-0.5 ' + (r.running ? 'bg-green-900 text-green-300' : 'bg-indigo-900 text-indigo-300')}>
                  {r.running ? 'Ahora' : `En ${r.startsInMin} min`}
                </span>
                {r.waiting && <span className='text-[11px] text-amber-400'>sin confirmar</span>}
              </div>
            </div>
            {fits.length > 0 ? (
              <>
                <button onClick={() => setOpenId(open ? null : r.table.id)} className='text-xs text-indigo-400 hover:underline'>
                  {open ? '▴ Ocultar' : `▾ Sumar a alguien (${fits.length} sin mesa que encaja${fits.length === 1 ? '' : 'n'})`}
                </button>
                {open && (
                  <ul className='space-y-1'>
                    {fits.map((f) => (
                      <li key={f.player.id} className='flex items-center justify-between gap-2 text-sm'>
                        <span className='truncate'>{f.player.name}{f.player.interests[r.table.gameId] === 'yes' && <span title='Votó este juego'> 👍</span>}</span>
                        <button onClick={() => onSeat(f.player, r)} disabled={busy}
                          className='shrink-0 text-xs bg-indigo-600 text-white rounded-lg px-2.5 py-1 hover:bg-indigo-700 disabled:opacity-50'>Sumar</button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : <p className='text-xs text-gray-500'>Nadie sin mesa le encaja ahora.</p>}
          </div>
        );
      })}
    </section>
  );
}

function PersonRow({ f, nowMin, label, onSeat, onArrived, busy }: {
  f: FreePerson; nowMin: number; label: TableLabel; busy: boolean;
  onSeat: (player: Player, row: FreeTable) => void; onArrived: (player: Player) => void;
}) {
  const [all, setAll] = useState(false);
  const direct = f.options.slice(0, 2);
  const rest = f.options.slice(2);
  const presence = f.presence === 'here' ? { text: 'En el lugar', cls: 'bg-green-900 text-green-300' }
    : f.presence === 'unconfirmed' ? { text: 'Sin confirmar', cls: 'bg-amber-900 text-amber-300' }
    : { text: `Llega ${f.player.arrivalTime}`, cls: 'bg-gray-700 text-gray-300' };
  const free = (f.freeFrom <= nowMin ? 'Libre ahora' : `Libre desde ${toTimeString(f.freeFrom)}`) + ` hasta ${toTimeString(f.freeUntil)}`;
  return (
    <li className='border border-gray-700 rounded-xl p-3 bg-gray-800/50 space-y-2'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='font-medium truncate'>{f.player.name}</p>
          <p className='text-xs text-gray-400'>{free}</p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <span className={'text-xs rounded-full px-2 py-0.5 ' + presence.cls}>{presence.text}</span>
          {f.presence !== 'here' && (
            <button onClick={() => onArrived(f.player)} disabled={busy} title='Confirmar que está en el lugar'
              className='text-xs border border-green-800 text-green-300 rounded-lg px-2 py-0.5 hover:bg-green-950/40 disabled:opacity-50'>✓ Llegó</button>
          )}
        </div>
      </div>
      {f.options.length === 0 ? <p className='text-xs text-gray-500'>No hay mesas con lugar que le encajen en ese rato.</p> : (
        <div className='flex flex-wrap gap-1.5'>
          {direct.map((o) => <SeatButton key={o.table.id} option={o} busy={busy} onSeat={() => onSeat(f.player, o)} label={label(o.table)} />)}
          {rest.length > 0 && !all && <button onClick={() => setAll(true)} className='text-xs text-indigo-400 hover:underline px-1'>Ver otras ({rest.length})</button>}
          {all && rest.map((o) => <SeatButton key={o.table.id} option={o} busy={busy} onSeat={() => onSeat(f.player, o)} label={label(o.table)} />)}
        </div>
      )}
    </li>
  );
}

/** People without a table now, and the ones who will be free soon, each with the tables that fit them. */
export function PeopleSection({ now, soon, nowMin, label, onSeat, onArrived, busy }: {
  now: FreePerson[]; soon: FreePerson[]; nowMin: number; label: TableLabel; busy: boolean;
  onSeat: (player: Player, row: FreeTable) => void; onArrived: (player: Player) => void;
}) {
  const props = { nowMin, label, onSeat, onArrived, busy };
  return (
    <section className='space-y-2'>
      <h2 className='font-semibold flex items-center gap-2'>🙋 Gente sin mesa <span className='text-sm font-normal text-gray-500'>({now.length + soon.length})</span></h2>
      <p className='text-xs text-gray-500'>Mientras no se use el check-in, «Sin confirmar» es alguien cuyo horario de llegada ya pasó. Con «✓ Llegó» (o al sentarlo en una mesa que está por empezar) queda confirmado.</p>
      <h3 className='text-sm text-gray-400 pt-1'>Ahora ({now.length})</h3>
      {now.length === 0 ? <p className='text-sm text-gray-500 border border-gray-800 rounded-xl p-3'>Nadie sin mesa en este momento.</p>
        : <ul className='space-y-2'>{now.map((f) => <PersonRow key={f.player.id} f={f} {...props} />)}</ul>}
      <h3 className='text-sm text-gray-400 pt-1'>Próximamente — en las próximas 2 horas ({soon.length})</h3>
      {soon.length === 0 ? <p className='text-sm text-gray-500 border border-gray-800 rounded-xl p-3'>Nadie más va a quedar libre en las próximas 2 horas.</p>
        : <ul className='space-y-2'>{soon.map((f) => <PersonRow key={f.player.id} f={f} {...props} />)}</ul>}
    </section>
  );
}

/** Find a person who is at a table and move them to another one, or take them out (they left, they won't come). */
export function MovePanel({ players, tables, rows, nowMin, label, onMove, onRemove, busy }: {
  players: Player[]; tables: Table[]; rows: FreeTable[]; nowMin: number; label: TableLabel; busy: boolean;
  onMove: (player: Player, from: Table, to: FreeTable) => void; onRemove: (player: Player, from: Table) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [moving, setMoving] = useState<string | null>(null); // `${playerId}:${tableId}`
  const q = query.trim().toLowerCase();
  const matches = q.length < 1 ? [] : players.filter((p) => p.name.toLowerCase().includes(q) && tablesOf(p, tables, nowMin).length > 0).slice(0, 6);
  return (
    <section className='space-y-2'>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className='w-full text-left border border-gray-700 rounded-xl px-3 py-2.5 hover:bg-gray-800 flex items-center justify-between'>
        <span className='font-semibold'>🔁 Cambió de mesa o se fue</span>
        <span className='text-gray-500 text-xs' aria-hidden='true'>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className='border border-gray-700 rounded-xl p-3 space-y-3'>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Buscar por nombre…' autoFocus
            className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm' />
          {q && matches.length === 0 && <p className='text-xs text-gray-500'>Nadie con ese nombre está en una mesa.</p>}
          {matches.map((p) => (
            <div key={p.id} className='space-y-1.5'>
              <p className='text-sm font-medium'>{p.name}</p>
              {tablesOf(p, tables, nowMin).map((t) => {
                const key = `${p.id}:${t.id}`;
                const dest = moving === key ? destinationsFor(p, rows, tables, t.id) : [];
                return (
                  <div key={t.id} className='border border-gray-800 rounded-lg p-2 space-y-1.5'>
                    <p className='text-xs text-gray-300'>{label(t)} · {t.startTime}–{t.endTime}</p>
                    <div className='flex flex-wrap gap-1.5'>
                      <button onClick={() => setMoving(moving === key ? null : key)} disabled={busy}
                        className='text-xs border border-indigo-700 text-indigo-300 rounded-lg px-2.5 py-1 hover:bg-indigo-950/40 disabled:opacity-50'>🔁 Cambiar de mesa</button>
                      <button onClick={() => onRemove(p, t)} disabled={busy}
                        className='text-xs border border-red-900 text-red-300 rounded-lg px-2.5 py-1 hover:bg-red-950/40 disabled:opacity-50'>Sacar de esta mesa</button>
                    </div>
                    {moving === key && (dest.length === 0
                      ? <p className='text-xs text-gray-500'>No hay otra mesa con lugar que le encaje.</p>
                      : <div className='flex flex-wrap gap-1.5'>
                          {dest.map((o) => (
                            <button key={o.table.id} onClick={() => { setMoving(null); onMove(p, t, o); }} disabled={busy}
                              className={'text-xs rounded-lg border px-2.5 py-1 text-left disabled:opacity-50 ' + (o.votedYes ? 'border-green-700 bg-green-950/40 text-green-200 hover:bg-green-950' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
                              {o.votedYes ? '👍 ' : ''}Pasar a {label(o.table)} · {o.table.startTime}
                            </button>
                          ))}
                        </div>)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
