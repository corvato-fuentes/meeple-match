'use client';

const MAX_SEATS = 20;

/**
 * "How many people play it": the minimum and maximum recommended for the game, laid out like the admin's game editor and
 * with the same "Recomendación BGG" note the time-per-player field has. The numbers come from BoardGameGeek when the game
 * was found there (`suggested`), but stay editable — BGG often counts a mode or an expansion nobody plays, and tables are
 * sized from them. The note shows only while a field still holds BGG's number.
 */
export default function PlayerCountFields({ min, max, suggested, onChange }: {
  min: number;
  max: number;
  /** What BGG recommended for this game, if it was picked from BGG. */
  suggested: { min: number; max: number } | null;
  onChange: (min: number, max: number) => void;
}) {
  const clamp = (n: number) => Math.min(MAX_SEATS, Math.max(1, Math.round(n) || 1));
  const field = 'w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 pr-28 text-sm';
  const noSigns = (e: React.KeyboardEvent<HTMLInputElement>) => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault(); };
  const bggNote = (show: boolean) => show && (
    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-indigo-400 pointer-events-none whitespace-nowrap">Recomendación BGG</span>
  );
  return (
    <div className="border border-gray-800 rounded-lg p-2 space-y-2">
      <p className="text-xs font-semibold text-gray-300">Cantidad de jugadores</p>
      <div>
        <label className="text-xs text-gray-400">🧑‍🤝‍🧑 ¿Cuánto creés vos que es el mínimo recomendado?</label>
        <div className="relative">
          <input type="number" min={1} max={MAX_SEATS} className={field} value={min} onFocus={(e) => e.target.select()} onKeyDown={noSigns}
            onChange={(e) => { const m = clamp(+e.target.value); onChange(m, Math.max(max, m)); }} />
          {bggNote(!!suggested && min === suggested.min)}
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-400">🧑‍🤝‍🧑 ¿Cuánto creés vos que es el máximo recomendado?</label>
        <div className="relative">
          <input type="number" min={1} max={MAX_SEATS} className={field} value={max} onFocus={(e) => e.target.select()} onKeyDown={noSigns}
            onChange={(e) => { const m = clamp(+e.target.value); onChange(Math.min(min, m), m); }} />
          {bggNote(!!suggested && max === suggested.max)}
        </div>
      </div>
    </div>
  );
}
