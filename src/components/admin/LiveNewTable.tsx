'use client';
import { useMemo, useState } from 'react';
import { DURATION_CHOICES, defaultDuration, findGameByText, suggestGames } from '@/lib/improvised';
import { addMinutes, isFreeBetween } from '@/lib/liveBoard';
import { isTentative } from '@/lib/registration';
import { toTimeString } from '@/lib/timeUtils';
import type { Game, Player, Table } from '@/lib/types';

export interface NewTableInput {
  game: { id: string; name: string } | { id: null; name: string; durationMinutes: number };
  startTime: string;
  endTime: string;
  playerIds: string[];
  guestCount: number;
}

/**
 * "Mesa nueva": a table that started in the room without being planned in the app. The organizers write it down — the game (one of the
 * event's or a new one), how long, who of the app sits and how many don't use it — so everything else on the screen stays true.
 */
export default function NewTablePanel({ games, players, tables, present, nowMin, busy, onCreate }: {
  games: Game[]; players: Player[]; tables: Table[]; present: Set<string>; nowMin: number; busy: boolean;
  onCreate: (input: NewTableInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [gameText, setGameText] = useState('');
  const [chosen, setChosen] = useState<Game | null>(null);
  const [duration, setDuration] = useState(90);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState(0);
  const [search, setSearch] = useState('');

  const typed = gameText.trim();
  // What the text means: the game chosen from the suggestions, an exact match of one that exists, or a new game
  const game = chosen ?? findGameByText(typed, games);
  const suggestions = useMemo(() => (chosen || !typed ? [] : suggestGames(typed, games)), [chosen, typed, games]);
  const end = addMinutes(toTimeString(nowMin), duration);

  // Everybody of the app who is free for the whole time the table will play
  const { free, busyCount } = useMemo(() => {
    const candidates = players.filter((p) => !isTentative(p));
    const freeOnes = candidates.filter((p) => isFreeBetween(p, tables, nowMin, nowMin + duration));
    freeOnes.sort((a, b) => Number(present.has(b.id)) - Number(present.has(a.id)) || a.name.localeCompare(b.name));
    return { free: freeOnes, busyCount: candidates.length - freeOnes.length };
  }, [players, tables, present, nowMin, duration]);
  const q = search.trim().toLowerCase();
  const shown = q ? free.filter((p) => p.name.toLowerCase().includes(q)) : free;
  // Someone who was ticked and stopped being free (the clock moved, or the duration grew) can't be kept
  const playerIds = [...picked].filter((id) => free.some((p) => p.id === id));
  const total = playerIds.length + guests;

  function chooseGame(g: Game) {
    setChosen(g);
    setGameText(g.name);
    setDuration(defaultDuration(g));
  }
  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function reset() {
    setGameText(''); setChosen(null); setDuration(90); setPicked(new Set()); setGuests(0); setSearch('');
  }
  function create() {
    if (!typed || total < 2) return;
    onCreate({
      game: game ? { id: game.id, name: game.name } : { id: null, name: typed, durationMinutes: duration },
      startTime: toTimeString(nowMin), endTime: end, playerIds, guestCount: guests,
    });
    reset();
    setOpen(false);
  }

  return (
    <section className='space-y-2'>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className='w-full text-left border border-purple-800 rounded-xl px-3 py-2.5 hover:bg-purple-950/30 flex items-center justify-between'>
        <span className='font-semibold'>➕ Mesa nueva <span className='text-xs font-normal text-gray-400'>— una que arrancó en el salón</span></span>
        <span className='text-gray-500 text-xs' aria-hidden='true'>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className='border border-gray-700 rounded-xl p-3 space-y-4'>
          <div className='space-y-1.5'>
            <label className='text-xs text-gray-400 block'>¿Qué juego?</label>
            <input value={gameText} onChange={(e) => { setGameText(e.target.value); setChosen(null); }} placeholder='Nombre del juego'
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm' />
            {suggestions.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {suggestions.map((g) => (
                  <button key={g.id} onClick={() => chooseGame(g)}
                    className='text-xs rounded-lg border border-gray-700 px-2.5 py-1 hover:bg-gray-800'>{g.name}{g.adHoc && <span className='text-gray-500'> · ya improvisado</span>}</button>
                ))}
              </div>
            )}
            {typed && (game
              ? <p className='text-xs text-gray-500'>{game.adHoc ? 'Un juego que ya anotaron como improvisado.' : 'Es uno de los juegos del evento.'}</p>
              : <p className='text-xs text-gray-500'>No está entre los juegos: se anota como juego nuevo. Los jugadores no lo ven en sus listas.</p>)}
          </div>

          <div className='space-y-1.5'>
            <p className='text-xs text-gray-400'>¿Hasta cuándo juegan? Empieza ahora ({toTimeString(nowMin)}) y termina a las {end}.</p>
            <div className='flex flex-wrap gap-1.5'>
              {DURATION_CHOICES.map((d) => (
                <button key={d} onClick={() => setDuration(d)} aria-pressed={duration === d}
                  className={'text-xs rounded-lg border px-2.5 py-1 ' + (duration === d ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
                  {d >= 60 ? `${d / 60 === Math.floor(d / 60) ? d / 60 : (d / 60).toFixed(1).replace('.', ',')} h` : `${d} min`}
                </button>
              ))}
            </div>
          </div>

          <div className='space-y-1.5'>
            <p className='text-xs text-gray-400'>Quiénes juegan, de los anotados en la app (los libres durante todo ese rato)</p>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Buscar por nombre…'
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm' />
            <ul className='max-h-52 overflow-y-auto space-y-0.5 border border-gray-800 rounded-lg p-1.5'>
              {shown.length === 0 && <li className='text-xs text-gray-500 p-1'>{q ? 'Nadie con ese nombre está libre.' : 'Nadie está libre para ese rato.'}</li>}
              {shown.map((p) => (
                <li key={p.id}>
                  <label className='flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 hover:bg-gray-800 rounded'>
                    <input type='checkbox' checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className='truncate'>{p.name}</span>
                    {present.has(p.id) && <span className='text-[11px] text-green-400 shrink-0'>en el lugar</span>}
                  </label>
                </li>
              ))}
            </ul>
            {busyCount > 0 && <p className='text-[11px] text-gray-500'>{busyCount} más tienen otra mesa en ese rato. Si una de ellas dejó su mesa, sacala primero desde «Cambió de mesa o se fue».</p>}
          </div>

          <div className='flex items-center justify-between gap-3'>
            <div>
              <p className='text-sm'>Personas sin la app</p>
              <p className='text-[11px] text-gray-500'>También ocupan lugar en la mesa.</p>
            </div>
            <div className='flex items-center gap-2'>
              <button onClick={() => setGuests((n) => Math.max(0, n - 1))} aria-label='Una menos' className='w-8 h-8 rounded-lg border border-gray-700 hover:bg-gray-800'>−</button>
              <span className='w-6 text-center font-medium'>{guests}</span>
              <button onClick={() => setGuests((n) => Math.min(20, n + 1))} aria-label='Una más' className='w-8 h-8 rounded-lg border border-gray-700 hover:bg-gray-800'>+</button>
            </div>
          </div>

          <div className='flex items-center justify-between gap-3'>
            <p className='text-xs text-gray-400'>{total} {total === 1 ? 'persona' : 'personas'} en la mesa{total < 2 ? ' (hacen falta al menos 2)' : ''}</p>
            <button onClick={create} disabled={busy || !typed || total < 2}
              className='bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40'>▶ Crear y empezar</button>
          </div>
        </div>
      )}
    </section>
  );
}
