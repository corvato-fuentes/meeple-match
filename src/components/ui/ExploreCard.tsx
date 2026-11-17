'use client';
import type { ReactNode } from 'react';
import type { ExploreRow, TableStep } from '@/lib/exploreTables';
import type { TableAccent } from '@/components/ui/WaitingTableInfo';

const STEPS: { key: Exclude<TableStep, 'done'>; label: string }[] = [
  { key: 'forming', label: 'Se arma' },
  { key: 'confirmed', label: 'Confirmada' },
  { key: 'playing', label: 'Jugando' },
];
const ORDER: TableStep[] = ['forming', 'confirmed', 'playing', 'done'];

/**
 * Where the table is in its life — se arma, confirmada, jugando — as three dots. The ones already passed are filled, the one it is at
 * is lit, and a finished table has all three filled.
 */
export function StepBar({ step }: { step: TableStep }) {
  const at = ORDER.indexOf(step);
  return (
    <div className='pt-2' role='img' aria-label={`Paso: ${step === 'done' ? 'terminó' : STEPS[at].label}`}>
      <div className='flex items-center gap-1'>
        {STEPS.map((s, i) => {
          const passed = i < at;
          const here = i === at;
          return (
            <div key={s.key} className='flex items-center gap-1 flex-1 last:flex-none'>
              <span className={'w-2.5 h-2.5 rounded-full border-2 shrink-0 ' + (passed ? 'bg-green-500 border-green-500' : here ? 'bg-amber-400 border-amber-400' : 'border-gray-600')} />
              {i < STEPS.length - 1 && <span className={'h-0.5 flex-1 ' + (passed ? 'bg-green-500' : 'bg-gray-700')} />}
            </div>
          );
        })}
      </div>
      <div className='flex justify-between text-[10px] text-gray-500 mt-0.5'>
        {STEPS.map((s, i) => <span key={s.key} className={i === at ? 'text-amber-300' : ''}>{s.label}</span>)}
      </div>
    </div>
  );
}

/** The colors of a table's card and the accent its info block uses: what it is for you, not just its state. */
export function toneOf(row: ExploreRow): { border: string; accent: TableAccent; chip: string } {
  const posted = !!row.table.postedByOwner;
  if (row.rejected) return { border: 'border-gray-700 bg-gray-900/40 opacity-80', accent: 'gray', chip: 'bg-gray-800 text-gray-400' };
  if (row.step === 'done') return { border: 'border-gray-700 bg-gray-900/40', accent: 'gray', chip: 'bg-gray-800 text-gray-400' };
  if (row.step === 'playing') return { border: 'border-emerald-800 bg-emerald-950/10', accent: 'green', chip: 'bg-emerald-900/60 text-emerald-300' };
  if (row.step === 'confirmed') return { border: 'border-green-800 bg-green-950/10', accent: 'green', chip: 'bg-green-900/60 text-green-300' };
  // Still gathering people: what it asks of you decides the color
  if (row.chips.has('for-you')) return { border: 'border-amber-700 bg-amber-950/20', accent: posted ? 'indigo' : 'amber', chip: 'bg-amber-900/60 text-amber-300' };
  if (posted) return { border: 'border-purple-800 bg-purple-950/20', accent: 'purple', chip: 'bg-purple-900/60 text-purple-300' };
  return { border: 'border-gray-700 bg-gray-800/40', accent: 'amber', chip: 'bg-gray-800 text-gray-300' };
}

/** The table in words: the state chip, as a small pill next to the game's name. */
export function RowLabel({ row }: { row: ExploreRow }) {
  return <span className={'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ' + toneOf(row).chip}>{row.label}</span>;
}

/** One table, the same everywhere: its info (children), the bar of steps and, below, the one thing the person can do. */
export default function ExploreCard({ row, info, actions }: { row: ExploreRow; info: ReactNode; actions?: ReactNode }) {
  return (
    <div className={'border rounded-xl p-3 ' + toneOf(row).border}>
      {info}
      {!row.rejected && <StepBar step={row.step} />}
      {actions && <div className='mt-3 space-y-2'>{actions}</div>}
    </div>
  );
}
