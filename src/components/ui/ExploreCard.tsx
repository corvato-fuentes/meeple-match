'use client';
import { useState, type ReactNode } from 'react';
import GameCover from '@/components/ui/GameCover';
import { COMPLEXITY_LABEL, durationLine, explainerLine, seatsLine, type ExploreRow, type TableStep } from '@/lib/exploreTables';
import type { Game } from '@/lib/types';

const STEPS: { key: Exclude<TableStep, 'done'>; label: string }[] = [
  { key: 'forming', label: 'Armando' },
  { key: 'confirmed', label: 'Confirmada' },
  { key: 'playing', label: 'Jugando' },
];
const ORDER: TableStep[] = ['forming', 'confirmed', 'playing', 'done'];

/**
 * Where the table is in its life — armando, confirmada, jugando — as three dots, with only the step it is at written. The ones already
 * passed are filled, the one it is at is lit, and a finished table has all three filled.
 */
export function StepBar({ step }: { step: TableStep }) {
  const at = ORDER.indexOf(step);
  const label = step === 'done' ? 'Terminó' : STEPS[at].label;
  return (
    <div className='flex items-center gap-1 pt-1.5' role='img' aria-label={`Paso: ${label}`}>
      {STEPS.map((s, i) => {
        const passed = i < at;
        const here = i === at;
        return (
          <div key={s.key} className='flex items-center gap-1 flex-1 last:flex-none min-w-0'>
            <span className={'w-2.5 h-2.5 rounded-full border-2 shrink-0 ' + (passed ? 'bg-green-500 border-green-500' : here ? 'bg-amber-400 border-amber-400' : 'border-gray-600')} />
            {i < STEPS.length - 1 && <span className={'h-0.5 flex-1 ' + (passed ? 'bg-green-500' : 'bg-gray-700')} />}
          </div>
        );
      })}
      <span className='text-[11px] text-gray-400 pl-1 whitespace-nowrap'>{label}</span>
    </div>
  );
}

/** One color per state, on the card's left edge and its label: the rest of the card stays neutral. */
export function toneOf(row: ExploreRow): { border: string; chip: string } {
  const posted = !!row.table.postedByOwner;
  if (row.rejected) return { border: 'border-l-gray-600 opacity-80', chip: 'bg-gray-800 text-gray-400' };
  if (row.step === 'done') return { border: 'border-l-gray-600', chip: 'bg-gray-800 text-gray-400' };
  if (row.step === 'playing') return { border: 'border-l-emerald-500', chip: 'bg-emerald-900/60 text-emerald-300' };
  if (row.step === 'confirmed') return { border: 'border-l-green-500', chip: 'bg-green-900/60 text-green-300' };
  // Still gathering people: what it asks of you decides the color
  if (row.chips.has('for-you')) return { border: 'border-l-amber-500', chip: 'bg-amber-900/60 text-amber-300' };
  if (posted) return { border: 'border-l-purple-500', chip: 'bg-purple-900/60 text-purple-300' };
  return { border: 'border-l-gray-500', chip: 'bg-gray-800 text-gray-300' };
}

/** The table in words: the state chip, as a small pill next to the game's name. */
export function RowLabel({ row }: { row: ExploreRow }) {
  return <span className={'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ' + toneOf(row).chip}>{row.label}</span>;
}

/**
 * One table, the same everywhere. What shows: the cover, the game with its state, when, how full, who explains and where it is in its
 * life; then what to do about it. Everything else — the time it takes, how hard it is, who brings it, who is interested, sharing — is
 * one tap away under "Ver detalle".
 */
export default function ExploreCard({ row, game, slot, nameOf, viewerId, who, interested, onView, note, actions, extras }: {
  row: ExploreRow;
  game: Game | undefined;
  /** The physical table of the schedule ("Mesa 3"), once the table has one. */
  slot: number | null;
  nameOf: (id: string) => string;
  viewerId: string;
  /** The "lo trae / lo explica" lines for the detail. */
  who: ReactNode;
  /** People offered the table who haven't answered yet; null when it has no offer step. */
  interested: number | null;
  onView: (kind: 'confirmed' | 'interested') => void;
  note?: ReactNode;
  actions?: ReactNode;
  /** In the detail, after the information: sharing the table, putting its game aside. */
  extras?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = row.table;
  const explainer = explainerLine(t, nameOf, viewerId);
  const duration = durationLine(t, game);
  return (
    <div className={'border border-gray-700 border-l-4 bg-gray-800/40 rounded-xl p-3 ' + toneOf(row).border}>
      <div className='flex items-stretch gap-3 min-w-0'>
        <GameCover imageUrl={game?.imageUrl} size='fill' />
        <div className='min-w-0 flex-1 space-y-0.5'>
          <p className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <span className='font-semibold text-gray-100'>{t.gameName}</span>
            <RowLabel row={row} />
          </p>
          <p className='text-sm text-gray-400'>{t.startTime}–{t.endTime}</p>
          <p className='text-sm text-gray-400'>{seatsLine(row)}{explainer && ` · ${explainer}`}</p>
          {!row.rejected && <StepBar step={row.step} />}
        </div>
      </div>
      {note && <p className='mt-2 text-xs text-amber-300'>{note}</p>}
      {actions && <div className='mt-3 space-y-2'>{actions}</div>}
      <button type='button' onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className='mt-2 text-xs text-indigo-300 hover:underline'>
        {open ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}
      </button>
      {open && (
        <div className='mt-2 pt-2 border-t border-gray-700 space-y-1.5 text-sm text-gray-400'>
          {slot != null && <p>🪑 Mesa {slot}</p>}
          {duration && <p>⏱ {duration}</p>}
          {game && <p>🧠 {COMPLEXITY_LABEL[game.complexity]}</p>}
          {who}
          <div className='flex flex-wrap gap-x-4 gap-y-1 pt-0.5'>
            {interested != null && <button type='button' onClick={() => onView('interested')} className='text-indigo-300 hover:underline'>🤔 {interested} {interested === 1 ? 'interesado' : 'interesados'} →</button>}
            <button type='button' onClick={() => onView('confirmed')} className='text-indigo-300 hover:underline'>👥 Ver quiénes están →</button>
          </div>
          {extras && <div className='pt-1.5 space-y-1.5'>{extras}</div>}
        </div>
      )}
    </div>
  );
}
