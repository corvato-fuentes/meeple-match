'use client';
import { useMemo, useState } from 'react';
import { DEFAULT_NEW_GAME_TIMES, DURATION_CHOICES, findGameByText, newGameMinutes, proposedMinutes, suggestGames, type NewGameTimes } from '@/lib/improvised';
import { addMinutes, isFreeBetween } from '@/lib/liveBoard';
import { isTentative } from '@/lib/registration';
import { toTimeString } from '@/lib/timeUtils';
import type { Game, Player, Table } from '@/lib/types';

export interface NewTableInput {
  game: { id: string; name: string } | {
    id: null; name: string; minPlayers: number; maxPlayers: number; setupMinutes: number; explanationMinutes: number; perPlayerMinutes: number;
  };
  startTime: string;
  endTime: string;
  playerIds: string[];
  guestCount: number;
}

const field = 'w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm';
const noSigns = (e: React.KeyboardEvent<HTMLInputElement>) => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault(); };

/** A whole-number field that can be emptied while typing (it is read as 0 then). */
function NumberField({ label, value, onChange, min = 0, max = 999, hint }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; hint?: string;
}) {
  return (
    <div>
      <label className='text-xs text-gray-400 block'>{label}</label>
      <input type='number' inputMode='numeric' min={min} max={max} className={field} value={Number.isNaN(value) ? '' : value} onFocus={(e) => e.target.select()} onKeyDown={noSigns}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Math.min(max, Math.max(0, Math.round(+e.target.value))))} />
      {hint && <p className='text-[11px] text-gray-500 mt-0.5'>{hint}</p>}
    </div>
  );
}

/**
 * "Mesa nueva": a table that started in the room without being planned in the app. The organizers write it down — the game (one of the
 * event's, or a new one loaded like any game, with its times), how long, who of the app sits and how many others don't use it — so
 * everything else on the screen stays true.
 */
export default function NewTablePanel({ games, players, tables, present, nowMin, busy, onCreate }: {
  games: Game[]; players: Player[]; tables: Table[]; present: Set<string>; nowMin: number; busy: boolean;
  onCreate: (input: NewTableInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [gameText, setGameText] = useState('');
  const [chosen, setChosen] = useState<Game | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null); // null = the proposal, until the organizers change it
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [guests, setGuests] = useState(0);
  const [search, setSearch] = useState('');
  // Only for a game that isn't loaded yet
  const [minP, setMinP] = useState(2);
  const [maxP, setMaxP] = useState(4);
  const [times, setTimes] = useState<NewGameTimes>(DEFAULT_NEW_GAME_TIMES);

  const typed = gameText.trim();
  // What the text means: the game chosen from the suggestions, an exact match of one that exists, or a new game
  const game = chosen ?? findGameByText(typed, games);
  const isNew = !!typed && !game;
  const suggestions = useMemo(() => (chosen || !typed ? [] : suggestGames(typed, games)), [chosen, typed, games]);

  // How long the table takes is proposed from the game's own numbers and how many people sit — and the organizers can change it.
  // The duration decides who is free, so people are computed on the proposal for the people ticked so far, then again on the real one.
  const proposalFor = (n: number) => (isNew ? newGameMinutes(times, n + guests) : proposedMinutes(game, n + guests));
  const candidates = useMemo(() => players.filter((p) => !isTentative(p)), [players]);
  const duration = minutes ?? proposalFor(picked.size);

  // Everybody of the app who is free for the whole time the table will play
  const { free, busyCount } = useMemo(() => {
    const freeOnes = candidates.filter((p) => isFreeBetween(p, tables, nowMin, nowMin + duration));
    freeOnes.sort((a, b) => Number(present.has(b.id)) - Number(present.has(a.id)) || a.name.localeCompare(b.name));
    return { free: freeOnes, busyCount: candidates.length - freeOnes.length };
  }, [candidates, tables, present, nowMin, duration]);
  const q = search.trim().toLowerCase();
  const shown = q ? free.filter((p) => p.name.toLowerCase().includes(q)) : free;
  // Someone who was ticked and stopped being free (the clock moved, or the duration grew) can't be kept
  const playerIds = [...picked].filter((id) => free.some((p) => p.id === id));
  const total = playerIds.length + guests;
  // The proposal follows the people who really sit
  const finalDuration = minutes ?? proposalFor(playerIds.length);
  const finalEnd = addMinutes(toTimeString(nowMin), finalDuration);

  const newGameOk = !isNew || (minP >= 1 && maxP >= minP && times.perPlayerMinutes > 0 && ![times.setupMinutes, times.explanationMinutes, times.perPlayerMinutes].some(Number.isNaN));

  function chooseGame(g: Game) { setChosen(g); setGameText(g.name); setMinutes(null); }
  function toggle(id: string) { setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function reset() {
    setGameText(''); setChosen(null); setMinutes(null); setPicked(new Set()); setGuests(0); setSearch('');
    setMinP(2); setMaxP(4); setTimes(DEFAULT_NEW_GAME_TIMES);
  }
  function create() {
    if (!typed || total < 2 || !newGameOk) return;
    onCreate({
      game: game
        ? { id: game.id, name: game.name }
        : { id: null, name: typed, minPlayers: minP, maxPlayers: maxP, ...times },
      startTime: toTimeString(nowMin), endTime: finalEnd, playerIds, guestCount: guests,
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
            <input value={gameText} onChange={(e) => { setGameText(e.target.value); setChosen(null); setMinutes(null); }} placeholder='Nombre del juego'
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm' />
            {suggestions.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {suggestions.map((g) => (
                  <button key={g.id} onClick={() => chooseGame(g)}
                    className='text-xs rounded-lg border border-gray-700 px-2.5 py-1 hover:bg-gray-800'>{g.name}{g.adHoc && <span className='text-gray-500'> · ya improvisado</span>}</button>
                ))}
              </div>
            )}
            {game && <p className='text-xs text-gray-500'>{game.adHoc ? 'Un juego que ya cargaron en una mesa improvisada.' : 'Es uno de los juegos del evento.'}</p>}
          </div>

          {isNew && (
            <div className='border border-gray-800 rounded-lg p-2.5 space-y-2.5'>
              <p className='text-xs text-gray-400'>Este juego no está cargado: se carga como uno normal, con sus jugadores y sus tiempos. Los jugadores no lo ven en sus listas ni lo votan.</p>
              <div className='grid grid-cols-2 gap-2'>
                <NumberField label='Mínimo de jugadores' value={minP} min={1} max={20} onChange={(n) => { setMinP(n); if (n > maxP) setMaxP(n); }} />
                <NumberField label='Máximo de jugadores' value={maxP} min={1} max={20} onChange={setMaxP} />
              </div>
              <div className='grid grid-cols-3 gap-2'>
                <NumberField label='Preparar (min)' value={times.setupMinutes} onChange={(n) => { setTimes({ ...times, setupMinutes: n }); setMinutes(null); }} />
                <NumberField label='Explicar (min)' value={times.explanationMinutes} onChange={(n) => { setTimes({ ...times, explanationMinutes: n }); setMinutes(null); }} />
                <NumberField label='Por jugador (min)' value={times.perPlayerMinutes} min={1} onChange={(n) => { setTimes({ ...times, perPlayerMinutes: n }); setMinutes(null); }} />
              </div>
            </div>
          )}

          <div className='space-y-1.5'>
            <label className='text-xs text-gray-400 block'>
              ¿Cuánto van a jugar? Empieza ahora ({toTimeString(nowMin)}) y termina a las {finalEnd}.
              {typed && minutes == null && <span className='text-gray-500'> Propuesto según {game ? 'el juego' : 'los tiempos de arriba'} y la gente que se sienta.</span>}
            </label>
            <div className='flex items-center gap-2'>
              <div className='w-24 shrink-0'>
                <input type='number' inputMode='numeric' min={15} max={480} step={5} className={field} value={Number.isNaN(finalDuration) ? '' : finalDuration} onFocus={(e) => e.target.select()} onKeyDown={noSigns}
                  onChange={(e) => setMinutes(e.target.value === '' ? null : Math.min(480, Math.max(0, Math.round(+e.target.value))))} />
              </div>
              <span className='text-xs text-gray-400'>minutos</span>
            </div>
            <div className='flex flex-wrap gap-1.5'>
              {DURATION_CHOICES.map((d) => (
                <button key={d} onClick={() => setMinutes(d)} aria-pressed={finalDuration === d}
                  className={'text-xs rounded-lg border px-2.5 py-1 ' + (finalDuration === d ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-300 hover:bg-gray-800')}>
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
              <p className='text-sm'>Otras personas que juegan y no están en la app</p>
              <p className='text-[11px] text-gray-500'>Alguien que se sumó sin anotarse. No tienen nombre acá: solo cuentan para que la mesa tenga sus lugares ocupados.</p>
            </div>
            <div className='flex items-center gap-2 shrink-0'>
              <button onClick={() => setGuests((n) => Math.max(0, n - 1))} aria-label='Una menos' className='w-8 h-8 rounded-lg border border-gray-700 hover:bg-gray-800'>−</button>
              <span className='w-6 text-center font-medium'>{guests}</span>
              <button onClick={() => setGuests((n) => Math.min(20, n + 1))} aria-label='Una más' className='w-8 h-8 rounded-lg border border-gray-700 hover:bg-gray-800'>+</button>
            </div>
          </div>

          <div className='flex items-center justify-between gap-3'>
            <p className='text-xs text-gray-400'>{total} {total === 1 ? 'persona' : 'personas'} en la mesa{total < 2 ? ' (hacen falta al menos 2)' : ''}</p>
            <button onClick={create} disabled={busy || !typed || total < 2 || !newGameOk}
              className='bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40'>▶ Crear y empezar</button>
          </div>
        </div>
      )}
    </section>
  );
}
