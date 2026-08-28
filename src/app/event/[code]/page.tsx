'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getGames, addPlayer, addGame, setGameOwner, getPlayers, getPlayerByTicketCode, findPlayerByContact,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { generateUniqueTicketCode } from '@/lib/ticketCode';
import { bggSearchUrl, searchBgg, getBggGameDetails, type BggSearchResult } from '@/lib/bgg';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';
import type { MeepleEvent, Game, GameComplexity, InterestLevel } from '@/lib/types';

type Step = 'loading' | 'closed' | 'reaccess' | 1 | 2 | 3;
type DraftGame = Omit<Game, 'id' | 'ownerPlayerId' | 'ownerName'>;

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Ligero',
  medium: 'Medio',
  heavy: 'Complejo',
};

export default function EventPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  const [step, setStep] = useState<Step>('loading');
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [ticketInput, setTicketInput] = useState('');
  const [ticketError, setTicketError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [alias, setAlias] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [contactError, setContactError] = useState('');
  const [existingTicket, setExistingTicket] = useState<string | null>(null);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [myGames, setMyGames] = useState<DraftGame[]>([]);
  const [newGame, setNewGame] = useState<DraftGame>({
    name: '', bggUrl: null, minPlayers: 2, maxPlayers: 4,
    durationMinutes: 60, complexity: 'medium',
  });
  const [canExplainNew, setCanExplainNew] = useState(false);
  const [canExplainIds, setCanExplainIds] = useState<number[]>([]);
  const [bggResults, setBggResults] = useState<BggSearchResult[]>([]);
  const [bggOpen, setBggOpen] = useState(false);
  const [bggLoading, setBggLoading] = useState(false);
  const skipBggSearchRef = useRef(false);
  const [canExplainOtherIds, setCanExplainOtherIds] = useState<string[]>([]);
  const [editingGameIndex, setEditingGameIndex] = useState<number | null>(null);
  const [interests, setInterests] = useState<Record<string, InterestLevel>>({});
  const [ownGameVotes, setOwnGameVotes] = useState<Record<number, InterestLevel>>({});

  useEffect(() => {
    if (skipBggSearchRef.current) { skipBggSearchRef.current = false; return; }
    const query = newGame.name.trim();
    if (query.length < 3) { setBggResults([]); setBggOpen(false); return; }
    const handle = setTimeout(async () => {
      setBggLoading(true);
      try {
        const results = await searchBgg(query);
        setBggResults(results);
        setBggOpen(results.length > 0);
      } catch (err) {
        console.error(err);
        setBggResults([]);
      } finally {
        setBggLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [newGame.name]);

  async function selectBggResult(result: BggSearchResult) {
    skipBggSearchRef.current = true;
    setBggOpen(false);
    setBggResults([]);
    try {
      const details = await getBggGameDetails(result.id);
      setNewGame((g) => ({
        ...g,
        name: result.name,
        bggUrl: details.bggUrl,
        minPlayers: details.minPlayers,
        maxPlayers: details.maxPlayers,
        durationMinutes: details.durationMinutes,
        complexity: details.complexity,
      }));
    } catch (err) {
      console.error(err);
      skipBggSearchRef.current = true;
      setNewGame((g) => ({ ...g, name: result.name }));
    }
  }

  useEffect(() => {
    async function init() {
      const saved = sessionStorage.getItem(STORAGE_KEY(code));
      if (saved) { router.replace('/event/' + code + '/me?ticket=' + saved); return; }
      const ev = await getEvent(code);
      if (!ev || ev.status === 'closed') { setStep('closed'); return; }
      const [gs, players] = await Promise.all([getGames(code), getPlayers(code)]);
      setEvent(ev);
      setGames(gs);
      setPlayerCount(players.length);
      setArrivalTime(ev.startTime);
      setDepartureTime(ev.endTime);
      setStep('reaccess');
    }
    init();
  }, [code, router]);

  async function handleReaccess(e: React.FormEvent) {
    e.preventDefault();
    setTicketError('');
    const player = await getPlayerByTicketCode(code, ticketInput.toUpperCase());
    if (!player) { setTicketError('Código no encontrado. Verificá y volvé a intentar.'); return; }
    sessionStorage.setItem(STORAGE_KEY(code), player.ticketCode);
    router.push('/event/' + code + '/me?ticket=' + player.ticketCode);
  }

  async function handleStep1Next() {
    setContactError('');
    setExistingTicket(null);
    if (event?.settings.maxPlayers != null && playerCount >= event.settings.maxPlayers) {
      setContactError('El evento ya alcanzó su capacidad máxima. No se pueden agregar más inscriptos.');
      return;
    }
    setCheckingDuplicate(true);
    const existing = await findPlayerByContact(code, email.trim() || null, phone.trim() || null);
    setCheckingDuplicate(false);
    if (existing) {
      setContactError('Ya hay alguien registrado con ese email o teléfono.');
      setExistingTicket(existing.ticketCode);
      return;
    }
    setStep(2);
  }

  function addGameToList() {
    if (!newGame.name) return;
    if (editingGameIndex != null) {
      const updated = [...myGames];
      updated[editingGameIndex] = newGame;
      setMyGames(updated);
      setCanExplainIds((ids) => {
        const without = ids.filter((i) => i !== editingGameIndex);
        return canExplainNew ? [...without, editingGameIndex] : without;
      });
      setEditingGameIndex(null);
    } else {
      const limit = event?.settings.maxGamesPerPlayer;
      if (limit != null && myGames.length >= limit) return;
      setMyGames([...myGames, newGame]);
      if (canExplainNew) setCanExplainIds([...canExplainIds, myGames.length]);
    }
    setNewGame({ name: '', bggUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium' });
    setCanExplainNew(false);
  }

  function editGame(index: number) {
    setNewGame(myGames[index]);
    setCanExplainNew(canExplainIds.includes(index));
    setEditingGameIndex(index);
  }

  function cancelEditGame() {
    setEditingGameIndex(null);
    setNewGame({ name: '', bggUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium' });
    setCanExplainNew(false);
  }

  function removeGame(index: number) {
    setMyGames(myGames.filter((_, i) => i !== index));
    setCanExplainIds((ids) => ids.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
    if (editingGameIndex === index) cancelEditGame();
  }

  function goToStep3() {
    setInterests({});
    setOwnGameVotes({});
    setStep(3);
  }

  function toggleCanExplainOther(gameId: string) {
    setCanExplainOtherIds((cur) => cur.includes(gameId) ? cur.filter((id) => id !== gameId) : [...cur, gameId]);
  }

  async function handleSubmit() {
    if (!event || submitting) return;
    setSubmitting(true);
    const displayName = alias.trim() || `${firstName.trim()} ${lastName.trim()}`.trim();
    const maxPlayers = event.settings.maxPlayers;
    if (maxPlayers != null && playerCount >= maxPlayers) { alert('El evento está completo.'); setSubmitting(false); return; }
    const ticketCode = await generateUniqueTicketCode(code);
    const savedGameIds: string[] = [];
    const canExplainGameIds: string[] = [];
    const finalInterests = { ...interests };
    for (let i = 0; i < myGames.length; i++) {
      const g = myGames[i];
      const gameId = await addGame(code, { ...g, ownerPlayerId: '__pending__', ownerName: displayName });
      savedGameIds.push(gameId);
      if (canExplainIds.includes(i)) canExplainGameIds.push(gameId);
      // Bringing a game doesn't imply wanting to play it — only counts if the player explicitly voted
      if (ownGameVotes[i]) finalInterests[gameId] = ownGameVotes[i];
    }
    await addPlayer(code, {
      name: displayName, firstName: firstName.trim(), lastName: lastName.trim(), alias: alias.trim() || null,
      email: email.trim() || null, phone: phone.trim() || null, arrivalTime, departureTime, ticketCode,
      bringGameIds: savedGameIds, interests: finalInterests, canExplain: [...canExplainGameIds, ...canExplainOtherIds],
    } as Parameters<typeof addPlayer>[1]).then((playerId) =>
      Promise.all(savedGameIds.map((gameId) => setGameOwner(code, gameId, playerId)))
    );
    // Fire-and-forget: don't make the player wait on the scheduling algorithm to see their ticket.
    if (event.settings.autoGenerate) runTableGeneration(code, event).catch(() => {});
    sessionStorage.setItem(STORAGE_KEY(code), ticketCode);
    router.push('/event/' + code + '/me?ticket=' + ticketCode);
  }

  if (step === 'loading') return <div className="p-8 text-center">Cargando...</div>;

  const isFull = event?.settings.maxPlayers != null && playerCount >= event.settings.maxPlayers;

  if (step === 'closed') return (
    <div className="p-8 text-center text-gray-400 space-y-4">
      <p>Este evento no está disponible.</p>
      <Link href="/" className="inline-block text-indigo-400 hover:underline text-sm">← Volver al inicio</Link>
    </div>
  );

  if (step === 'reaccess') return (
    <main className="max-w-sm mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-1">{event?.name}</h1>
      <p className="text-gray-400 mb-1 text-sm">{event?.date} · {event?.location}</p>
      {event?.mapUrl && (
        <a href={event.mapUrl} target="_blank" rel="noopener noreferrer"
          className="text-indigo-400 text-sm hover:underline inline-block mb-7">
          📍 Ver ubicación en el mapa
        </a>
      )}
      {!event?.mapUrl && <div className="mb-8" />}
      <div className="space-y-3">
        {isFull ? (
          <div className="border border-amber-800 bg-amber-950/30 rounded-xl px-4 py-3 text-sm text-amber-300">
            🚫 Este evento ya alcanzó su capacidad máxima ({playerCount}/{event?.settings.maxPlayers}). No se pueden agregar más inscriptos.
          </div>
        ) : (
          <button onClick={() => setStep(1)} className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold hover:bg-indigo-700">
            Registrarme
          </button>
        )}
        <form onSubmit={handleReaccess} className="space-y-2">
          <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2 text-center tracking-widest uppercase font-mono"
            placeholder="MI CÓDIGO" value={ticketInput}
            onChange={(e) => setTicketInput(e.target.value.trim().toUpperCase().slice(0, 6))} />
          {ticketError && <p className="text-red-400 text-sm">{ticketError}</p>}
          <button type="submit" className="w-full border border-indigo-500 text-indigo-400 rounded-xl py-2 font-medium hover:bg-indigo-950">
            Ya me registré — tengo mi código
          </button>
        </form>
      </div>
    </main>
  );

  if (step === 1) return (
    <main className="max-w-sm mx-auto px-4 py-12">
      <p className="text-xs text-gray-500 mb-1">Paso 1 de 3</p>
      <h2 className="text-xl font-bold mb-6">¿Quién sos?</h2>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={firstName}
              onChange={(e) => setFirstName(e.target.value)} placeholder="Nombre" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Apellido</label>
            <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={lastName}
              onChange={(e) => setLastName(e.target.value)} placeholder="Apellido" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Alias (opcional)</label>
          <input className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={alias}
            onChange={(e) => setAlias(e.target.value)} placeholder="Cómo te dicen — se muestra en vez del nombre" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Teléfono{event?.settings.phoneRequired ? '' : ' (opcional)'}</label>
            <input type="tel" className="w-full border border-gray-700 bg-gray-900 rounded-xl px-3 py-2" value={phone}
              onChange={(e) => setPhone(e.target.value)} placeholder={event?.settings.phoneRequired ? '' : 'opcional'} />
          </div>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          {event?.settings.phoneRequired ? 'El teléfono es obligatorio para este evento.' : 'Cargá al menos uno, así evitamos registros duplicados.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Llegás</label>
            <TimeWheelPicker value={arrivalTime} onChange={setArrivalTime} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Te vas</label>
            <TimeWheelPicker value={departureTime} onChange={setDepartureTime} />
          </div>
        </div>
        {contactError && (
          <div className="text-sm text-red-400 space-y-1">
            <p>{contactError}</p>
            {existingTicket && (
              <button
                onClick={() => { sessionStorage.setItem(STORAGE_KEY(code), existingTicket); router.push('/event/' + code + '/me?ticket=' + existingTicket); }}
                className="text-indigo-400 hover:underline">
                Ver mi ticket →
              </button>
            )}
          </div>
        )}
        <button disabled={!firstName.trim() || !lastName.trim() || !arrivalTime || !departureTime || (event?.settings.phoneRequired ? !phone.trim() : (!email.trim() && !phone.trim())) || checkingDuplicate}
          onClick={handleStep1Next}
          className="w-full bg-indigo-600 text-white rounded-xl py-3 font-semibold hover:bg-indigo-700 disabled:opacity-40">
          {checkingDuplicate ? 'Verificando...' : 'Siguiente →'}
        </button>
      </div>
    </main>
  );


  if (step === 2) {
    const limit = event?.settings.maxGamesPerPlayer;
    const atLimit = limit != null && myGames.length >= limit;
    return (
      <main className="max-w-sm mx-auto px-4 py-12">
        <p className="text-xs text-gray-500 mb-1">Paso 2 de 3</p>
        <h2 className="text-xl font-bold mb-2">¿Qué juegos traés?</h2>
        <p className="text-sm text-gray-400 mb-5">
          {limit
            ? ('Podés agregar hasta ' + limit + ' juego' + (limit !== 1 ? 's' : '') + '.')
            : 'Podés agregar todos los que querás.'}
        </p>
        <div className="space-y-2 mb-5">
          {myGames.map((g, i) => (
            <div key={i} className={'flex items-center justify-between border rounded-xl px-3 py-2 bg-gray-800 ' + (editingGameIndex === i ? 'border-indigo-500' : 'border-gray-700')}>
              <div>
                <span className="font-medium">{g.name}</span>
                <span className="text-xs text-gray-500 ml-2">{g.minPlayers}–{g.maxPlayers}p · {g.durationMinutes}min · {COMPLEXITY_LABEL[g.complexity]}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => editGame(i)} className="text-xs text-indigo-400 hover:underline">Editar</button>
                <button onClick={() => removeGame(i)} className="text-xs text-red-400 hover:underline">Quitar</button>
              </div>
            </div>
          ))}
        </div>
        {(!atLimit || editingGameIndex != null) && (
          <div className="space-y-3 border border-gray-700 rounded-xl p-4 bg-gray-800 mb-5">
            <div className="relative">
              <input className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2" placeholder="Nombre del juego"
                value={newGame.name} onChange={(e) => setNewGame({ ...newGame, name: e.target.value })}
                onFocus={() => { if (bggResults.length > 0) setBggOpen(true); }}
                onBlur={() => setTimeout(() => setBggOpen(false), 150)} />
              {bggLoading && <p className="text-xs text-gray-500 mt-1">Buscando en BGG...</p>}
              {bggOpen && bggResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {bggResults.map((r) => (
                    <button key={r.id} type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectBggResult(r); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 flex justify-between gap-2">
                      <span className="truncate">{r.name}</span>
                      {r.year && <span className="text-gray-500 text-xs shrink-0">{r.year}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm" placeholder="Link BGG (opcional)"
              value={newGame.bggUrl ?? ''} onChange={(e) => setNewGame({ ...newGame, bggUrl: e.target.value || null })} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400">Mín. jugadores</label>
                <input type="number" min={1} max={20} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                  value={newGame.minPlayers} onFocus={(e) => e.target.select()}
                  onChange={(e) => setNewGame({ ...newGame, minPlayers: +e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-400">Máx. jugadores</label>
                <input type="number" min={1} max={20} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                  value={newGame.maxPlayers} onFocus={(e) => e.target.select()}
                  onChange={(e) => setNewGame({ ...newGame, maxPlayers: +e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-400">Duración (min)</label>
                <input type="number" min={10} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                  value={newGame.durationMinutes} onFocus={(e) => e.target.select()}
                  onChange={(e) => setNewGame({ ...newGame, durationMinutes: +e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-gray-400">Complejidad</label>
                <select className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm" value={newGame.complexity}
                  onChange={(e) => setNewGame({ ...newGame, complexity: e.target.value as GameComplexity })}>
                  <option value="light">Light</option>
                  <option value="medium">Medium</option>
                  <option value="heavy">Heavy</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={canExplainNew} onChange={(e) => setCanExplainNew(e.target.checked)} />
              Sé explicarlo
            </label>
            <div className="flex gap-2">
              {editingGameIndex != null && (
                <button onClick={cancelEditGame} className="flex-1 border border-gray-700 rounded-lg py-2 text-sm font-medium">
                  Cancelar
                </button>
              )}
              <button onClick={addGameToList} disabled={!newGame.name}
                className="flex-1 bg-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-600 disabled:opacity-40">
                {editingGameIndex != null ? 'Guardar cambios' : '+ Agregar juego'}
              </button>
            </div>
          </div>
        )}
        {atLimit && editingGameIndex == null && (
          <p className="text-amber-400 text-sm mb-5">
            {'Alcanzaste el límite de ' + limit + ' juego' + (limit !== 1 ? 's' : '') + ' para este evento.'}
          </p>
        )}
        {myGames.length === 0 && (
          <p className="text-xs text-gray-500 mb-5">
            🎲 ¿No traés ningún juego? No hay problema — vas a poder elegir entre los que traigan otros jugadores.
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={() => setStep(1)} className="flex-1 border border-gray-700 rounded-xl py-2 text-sm">← Atrás</button>
          <button onClick={goToStep3} className="flex-1 bg-indigo-600 text-white rounded-xl py-2 font-semibold hover:bg-indigo-700">
            {myGames.length === 0 ? 'No traigo juegos →' : 'Siguiente →'}
          </button>
        </div>
      </main>
    );
  }

  if (step === 3) {
    const isEmpty = games.length === 0;
    return (
      <main className="max-w-sm mx-auto px-4 py-12">
        <p className="text-xs text-gray-500 mb-1">Paso 3 de 3</p>
        <h2 className="text-xl font-bold mb-2">¿Qué querés jugar?</h2>
        {isEmpty
          ? <p className="text-sm text-gray-400 mb-6">
              {playerCount === 0
                ? 'Sos el primero en inscribirte 🎉 Todavía no hay personas registradas.'
                : `Todavía nadie cargó juegos 🎉 Hasta ahora se registraron ${playerCount} persona${playerCount !== 1 ? 's' : ''}.`}
            </p>
          : <p className="text-sm text-gray-400 mb-5">Hasta ahora se registraron {playerCount} persona{playerCount !== 1 ? 's' : ''}.</p>
        }
        {myGames.length > 0 && (
          <div className="space-y-2 mb-6">
            <p className="text-xs text-gray-500 -mb-1">Tus juegos — ¿los querés jugar vos también?</p>
            {myGames.map((g, i) => (
              <div key={'own-' + i} className="border border-gray-700 rounded-xl px-4 py-3 bg-gray-800">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-gray-500">{g.minPlayers}–{g.maxPlayers}p · {COMPLEXITY_LABEL[g.complexity]}</span>
                </div>
                <div className="flex gap-1">
                  {(['must', 'casual', 'no'] as InterestLevel[]).map((level) => {
                    const active = ownGameVotes[i] === level;
                    const cls = active
                      ? level === 'must' ? 'bg-red-900 border-red-600 text-red-300'
                        : level === 'casual' ? 'bg-blue-900 border-blue-600 text-blue-300'
                        : 'bg-gray-700 border-gray-500 text-gray-300'
                      : 'border-gray-700 text-gray-500 hover:bg-gray-800';
                    return (
                      <button key={level}
                        onClick={() => setOwnGameVotes({ ...ownGameVotes, [i]: level })}
                        className={'flex-1 py-1 text-xs rounded-lg border transition-colors ' + cls}>
                        {level === 'must' ? '❤️ Quiero' : level === 'casual' ? '👍 Me sumo' : '👎 Solo lo comparto'}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 mb-6">
          {games.map((g) => (
            <div key={g.id} className="border border-gray-700 rounded-xl px-4 py-3 bg-gray-800">
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium">{g.name}</span>
                <span className="text-xs text-gray-500">{g.minPlayers}–{g.maxPlayers}p · {COMPLEXITY_LABEL[g.complexity]}</span>
              </div>
              <a href={g.bggUrl ?? bggSearchUrl(g.name)} target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:underline inline-block mb-2">
                {g.bggUrl ? '🎲 Ver en BGG' : '🎲 Buscar en BGG'}
              </a>
              <div className="flex gap-1 mt-1">
                {(['must', 'casual', 'no'] as InterestLevel[]).map((level) => {
                  const active = interests[g.id] === level;
                  const cls = active
                    ? level === 'must' ? 'bg-red-900 border-red-600 text-red-300'
                      : level === 'casual' ? 'bg-blue-900 border-blue-600 text-blue-300'
                      : 'bg-gray-700 border-gray-500 text-gray-300'
                    : 'border-gray-700 text-gray-500 hover:bg-gray-800';
                  return (
                    <button key={level}
                      onClick={() => setInterests({ ...interests, [g.id]: level })}
                      className={'flex-1 py-1 text-xs rounded-lg border transition-colors ' + cls}>
                      {level === 'must' ? '❤️ Quiero' : level === 'casual' ? '👍 Me sumo' : '👎 No'}
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400 mt-2">
                <input type="checkbox" checked={canExplainOtherIds.includes(g.id)}
                  onChange={() => toggleCanExplainOther(g.id)} />
                Sé explicarlo
              </label>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={() => setStep(2)} className="flex-1 border border-gray-700 rounded-xl py-2 text-sm">← Atrás</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="flex-1 bg-indigo-600 text-white rounded-xl py-2 font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? 'Guardando...' : '¡Listo! →'}
          </button>
        </div>
      </main>
    );
  }

  return null;
}
