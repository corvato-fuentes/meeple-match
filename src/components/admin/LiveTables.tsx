'use client';
import { useState } from 'react';
import type { LiveTable } from '@/lib/liveBoard';
import { toMinutes } from '@/lib/timeUtils';
import type { Game, Player, Table } from '@/lib/types';

type Label = (t: Table) => string;

export interface TableActions {
  /** Starts the table: the ones in `presentIds` are confirmed as there; the ones in `absentIds` leave it (their place frees up). */
  onStart: (table: Table, presentIds: string[], absentIds: string[]) => void;
  onFinish: (table: Table) => void;
  /** Keeps playing: the table ends 15 minutes later. */
  onExtend: (table: Table) => void;
  /** Waits for people: the whole table moves 15 minutes later. */
  onWait: (table: Table) => void;
  /** An unconfirmed table gets confirmed by hand. */
  onConfirm: (table: Table) => void;
  /** A table that was never played (its time passed, or nobody came). */
  onCancel: (table: Table) => void;
}

const btn = 'text-xs rounded-lg border px-2.5 py-1.5 disabled:opacity-50';
const main = btn + ' border-green-700 bg-green-950/40 text-green-200 hover:bg-green-950';
const side = btn + ' border-gray-700 text-gray-300 hover:bg-gray-800';

/** "Is everyone here?": who is at the table, to start it. The ones left unchecked leave the table. */
function StartChecklist({ item, name, minPlayers, onCancel, onStart, busy }: {
  item: LiveTable; name: (id: string) => string; minPlayers: number; onCancel: () => void; busy: boolean;
  onStart: (presentIds: string[], absentIds: string[]) => void;
}) {
  const missing = new Set(item.missingIds);
  const [here, setHere] = useState<Record<string, boolean>>(() => Object.fromEntries(item.memberIds.map((id) => [id, !missing.has(id)])));
  const presentIds = item.memberIds.filter((id) => here[id]);
  const absentIds = item.memberIds.filter((id) => !here[id]);
  // Only the seated ones count towards the minimum (an explainer who only explains doesn't take a seat)
  const seatedLeft = presentIds.filter((id) => item.table.playerIds.includes(id)).length;
  return (
    <div className='border border-indigo-800 bg-indigo-950/30 rounded-lg p-3 space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-sm font-medium'>¿Quiénes están en la mesa?</p>
        <button type='button' onClick={() => setHere(Object.fromEntries(item.memberIds.map((id) => [id, true])))} className='text-xs text-indigo-300 hover:underline'>✓ Están todos</button>
      </div>
      <ul className='space-y-1'>
        {item.memberIds.map((id) => (
          <li key={id}>
            <label className='flex items-center gap-2 text-sm cursor-pointer'>
              <input type='checkbox' checked={!!here[id]} onChange={(e) => setHere((h) => ({ ...h, [id]: e.target.checked }))} />
              <span className={here[id] ? '' : 'text-gray-500 line-through'}>{name(id)}</span>
              {item.table.explainerId === id && <span className='text-[11px] text-purple-300'>explica</span>}
            </label>
          </li>
        ))}
      </ul>
      {absentIds.length > 0 && <p className='text-xs text-amber-300'>Los que no marques salen de la mesa y su lugar queda libre.</p>}
      {seatedLeft < minPlayers && <p className='text-xs text-amber-300'>Quedarían {seatedLeft}: el juego pide al menos {minPlayers}. Se puede empezar igual.</p>}
      <div className='flex gap-2'>
        <button onClick={() => onStart(presentIds, absentIds)} disabled={busy || presentIds.length === 0}
          className='text-sm bg-indigo-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-indigo-700 disabled:opacity-50'>▶ Empezar</button>
        <button onClick={onCancel} className='text-sm border border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-800'>Cancelar</button>
      </div>
    </div>
  );
}

function TableCard({ item, nowMin, name, label, minPlayers, actions, busy }: {
  item: LiveTable; nowMin: number; name: (id: string) => string; label: Label; minPlayers: number; actions: TableActions; busy: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const { table, kind, minutes, memberIds, missingIds } = item;
  const badge = kind === 'late' ? { text: `Debía empezar hace ${minutes} min`, cls: 'bg-red-900 text-red-300' }
    : kind === 'overtime' ? { text: `Pasó su hora hace ${minutes} min`, cls: 'bg-red-900 text-red-300' }
    : kind === 'past' ? { text: `Ya pasó su hora · ¿se jugó?`, cls: 'bg-gray-700 text-gray-300' }
    : kind === 'running' ? { text: `En curso · termina en ${Math.max(0, toMinutes(table.endTime) - nowMin)} min`, cls: 'bg-green-900 text-green-300' }
    : kind === 'upcoming' ? { text: `Empieza en ${minutes} min`, cls: 'bg-indigo-900 text-indigo-300' }
    : { text: minutes > 0 ? `Sin confirmar · debía empezar hace ${minutes} min` : `Sin confirmar · empieza en ${-minutes} min`, cls: 'bg-amber-900 text-amber-300' };
  const missing = new Set(missingIds);
  return (
    <li className={'border rounded-xl p-3 space-y-2 ' + (item.attention ? 'border-red-800 bg-red-950/20' : 'border-gray-700 bg-gray-800/50')}>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='font-medium leading-snug'>{label(table)}</p>
          <p className='text-xs text-gray-400'>{table.startTime}–{table.endTime}</p>
        </div>
        <span className={'text-xs rounded-full px-2 py-0.5 text-right shrink-0 max-w-[55%] ' + badge.cls}>{badge.text}</span>
      </div>
      <p className='text-xs leading-relaxed'>
        {memberIds.map((id, i) => (
          <span key={id} className={missing.has(id) ? 'text-amber-300' : 'text-gray-300'}>{i > 0 ? ' · ' : ''}{missing.has(id) ? '?' : '✓'} {name(id)}</span>
        ))}
      </p>
      {kind === 'past' && <p className='text-xs text-gray-500'>Nadie la marcó: no figura como jugada ni como cancelada.</p>}
      {kind === 'unconfirmed' && <p className='text-xs text-gray-500'>El sistema la propuso y todavía no llegó al mínimo de gente que aceptó.</p>}
      {starting ? (
        <StartChecklist item={item} name={name} minPlayers={minPlayers} busy={busy} onCancel={() => setStarting(false)}
          onStart={(present, absent) => { setStarting(false); actions.onStart(table, present, absent); }} />
      ) : (
        <div className='flex flex-wrap gap-1.5'>
          {(kind === 'late' || kind === 'upcoming') && <button onClick={() => setStarting(true)} disabled={busy} className={main}>▶ Empezar</button>}
          {kind === 'unconfirmed' && <button onClick={() => actions.onConfirm(table)} disabled={busy} className={main}>✅ Confirmar</button>}
          {kind === 'past' && <button onClick={() => actions.onFinish(table)} disabled={busy} className={main}>🏁 Se jugó</button>}
          {kind === 'past' && <button onClick={() => actions.onCancel(table)} disabled={busy} className={side}>No se jugó</button>}
          {(kind === 'running' || kind === 'overtime') && <button onClick={() => actions.onFinish(table)} disabled={busy} className={main}>🏁 Terminó</button>}
          {(kind === 'running' || kind === 'overtime') && <button onClick={() => actions.onExtend(table)} disabled={busy} className={side}>+15 min</button>}
          {kind !== 'running' && kind !== 'overtime' && kind !== 'past' && <button onClick={() => actions.onWait(table)} disabled={busy} className={side}>Esperar 15 min</button>}
        </div>
      )}
    </li>
  );
}

/** The tables to run the event with: the ones that need attention first, then the ones being played, then the ones about to start. */
export function TablesSection({ items, nowMin, players, games, label, actions, busy }: {
  items: LiveTable[]; nowMin: number; players: Player[]; games: Game[]; label: Label; actions: TableActions; busy: boolean;
}) {
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const name = (id: string) => nameOf.get(id) ?? 'Alguien';
  const minOf = (t: Table) => Math.max(2, games.find((g) => g.id === t.gameId)?.minPlayers ?? 2);
  const attention = items.filter((i) => i.attention);
  const running = items.filter((i) => !i.attention && i.kind === 'running');
  const next = items.filter((i) => !i.attention && (i.kind === 'upcoming' || i.kind === 'unconfirmed'));
  const render = (list: LiveTable[]) => (
    <ul className='space-y-2'>{list.map((i) => <TableCard key={i.table.id} item={i} nowMin={nowMin} name={name} label={label} minPlayers={minOf(i.table)} actions={actions} busy={busy} />)}</ul>
  );
  return (
    <>
      {attention.length > 0 && (
        <section className='space-y-2'>
          <h2 className='font-semibold'>⚠️ Pide atención <span className='text-sm font-normal text-gray-500'>({attention.length})</span></h2>
          {render(attention)}
        </section>
      )}
      <section className='space-y-2'>
        <h2 className='font-semibold'>🎲 En curso <span className='text-sm font-normal text-gray-500'>({running.length})</span></h2>
        {running.length === 0 ? <p className='text-sm text-gray-500 border border-gray-800 rounded-xl p-3'>No hay mesas en curso.</p> : render(running)}
      </section>
      <section className='space-y-2'>
        <h2 className='font-semibold'>⏳ Por empezar <span className='text-sm font-normal text-gray-500'>({next.length})</span></h2>
        <p className='text-xs text-gray-500'>Las que empiezan en la próxima hora. Al tocar «Empezar» marcás quiénes están: ya quedan confirmados como presentes.</p>
        {next.length === 0 ? <p className='text-sm text-gray-500 border border-gray-800 rounded-xl p-3'>No hay mesas por empezar en la próxima hora.</p> : render(next)}
      </section>
    </>
  );
}
