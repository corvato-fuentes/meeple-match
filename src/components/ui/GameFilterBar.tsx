'use client';
import { useState } from 'react';
import {
  DURATION_LABEL, NO_FILTERS, activeFilterCount, hasAnyFilter, type DurationRange, type GameFilters,
} from '@/lib/gameFilters';
import type { GameComplexity } from '@/lib/types';

const COMPLEXITIES: { value: GameComplexity; label: string }[] = [
  { value: 'light', label: 'Liviano' },
  { value: 'medium', label: 'Intermedio' },
  { value: 'heavy', label: 'Pesado' },
];
const PLAYER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

interface Props {
  filters: GameFilters;
  onChange: (next: GameFilters) => void;
  /** Games currently shown / games in the list before filtering — for the "Mostrando X de Y" line. */
  shown: number;
  total: number;
}

/** Search box + a collapsible set of filters (difficulty, duration, how many people play) for the voting list. */
export default function GameFilterBar({ filters, onChange, shown, total }: Props) {
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(filters);
  const set = (patch: Partial<GameFilters>) => onChange({ ...filters, ...patch });
  const toggleComplexity = (c: GameComplexity) =>
    set({ complexity: filters.complexity.includes(c) ? filters.complexity.filter((x) => x !== c) : [...filters.complexity, c] });

  return (
    <div className="space-y-2 mb-3">
      <div className="flex gap-2">
        <input type="search" value={filters.query} onChange={(e) => set({ query: e.target.value })}
          placeholder="🔍 Buscar juego o quién lo trae" aria-label="Buscar juego"
          className="flex-1 min-w-0 border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm" />
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-gray-800 ${active > 0 ? 'border-indigo-500 text-indigo-300' : 'border-gray-700 text-gray-300'}`}>
          ⚙️ Filtros
          {active > 0 && <span className="rounded-full bg-indigo-500 text-white text-[10px] font-bold leading-4 px-1.5">{active}</span>}
        </button>
      </div>

      {open && (
        <div className="border border-gray-700 rounded-xl p-3 space-y-3 bg-gray-900/50 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Dificultad</p>
            <div className="flex flex-wrap gap-2">
              {COMPLEXITIES.map((c) => {
                const on = filters.complexity.includes(c.value);
                return (
                  <button key={c.value} onClick={() => toggleComplexity(c.value)} aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
                    🧠 {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs text-gray-400 mb-1.5">Duración</span>
              <select value={filters.duration} onChange={(e) => set({ duration: e.target.value as DurationRange })}
                className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1.5 text-sm">
                {(Object.keys(DURATION_LABEL) as DurationRange[]).map((d) => <option key={d} value={d}>{DURATION_LABEL[d]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-gray-400 mb-1.5">Cantidad de jugadores</span>
              <select value={filters.players ?? ''} onChange={(e) => set({ players: e.target.value ? Number(e.target.value) : null })}
                className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1.5 text-sm">
                <option value="">Cualquiera</option>
                {PLAYER_COUNTS.map((n) => <option key={n} value={n}>{n === 1 ? '1 (solitario)' : `${n} jugadores`}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

      {hasAnyFilter(filters) && (
        <p className="flex items-center justify-between text-xs text-gray-500">
          <span>Mostrando {shown} de {total}</span>
          <button onClick={() => onChange(NO_FILTERS)} className="text-indigo-400 hover:underline">Limpiar filtros</button>
        </p>
      )}
    </div>
  );
}
