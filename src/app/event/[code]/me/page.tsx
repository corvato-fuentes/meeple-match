'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames,
  updatePlayerWishlist, subscribeTables, getPlayerTables, addPlayerGame, updateGame, removePlayerGame, updatePlayerTimes,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { TEACH_ONLY_MINUTES } from '@/lib/tableAlgorithm';
import { toMinutes, toTimeString } from '@/lib/timeUtils';
import { BOARD_RETURN_KEY } from '@/lib/boardReturn';
import { savePlayerEvent } from '@/lib/myEvents';
import { bggSearchUrl, searchBgg, getBggGameDetails, type BggSearchResult } from '@/lib/bgg';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';
import VotingHelp from '@/components/ui/VotingHelp';
import TablesHelp from '@/components/ui/TablesHelp';
import WhyVoteHelp from '@/components/ui/WhyVoteHelp';
import type { MeepleEvent, Player, Game, Table, GameComplexity, DraftGame } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

type InterestLevel = 'must' | 'casual' | 'no';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Ligero',
  medium: 'Medio',
  heavy: 'Complejo',
};

const EMPTY_DRAFT_GAME: DraftGame = {
  name: '', bggUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium',
};

export default function MyTicketPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [myTables, setMyTables] = useState<Table[]>([]);
  const [interests, setInterests] = useState<Record<string, InterestLevel>>({});
  const [canExplain, setCanExplain] = useState<string[]>([]);
  const [repeatGameIds, setRepeatGameIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showAddGame, setShowAddGame] = useState(false);
  const [newGame, setNewGame] = useState<DraftGame>(EMPTY_DRAFT_GAME);
  const [canExplainNew, setCanExplainNew] = useState(false);
  const [addingGame, setAddingGame] = useState(false);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [editingTimes, setEditingTimes] = useState(false);
  const [draftArrival, setDraftArrival] = useState('');
  const [draftDeparture, setDraftDeparture] = useState('');
  const [savingTimes, setSavingTimes] = useState(false);
  const [bggResults, setBggResults] = useState<BggSearchResult[]>([]);
  const [bggOpen, setBggOpen] = useState(false);
  const [bggLoading, setBggLoading] = useState(false);
  const skipBggSearchRef = useRef(false);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? localStorage.getItem(STORAGE_KEY(code))) as string | null;
    if (!ticketCode) { router.replace('/event/' + code); return; }
    async function load() {
      const [ev, gs] = await Promise.all([getEvent(code), getGames(code)]);
      const p = await getPlayerByTicketCode(code, ticketCode!);
      if (!p || !ev) { router.replace('/event/' + code); return; }
      setEvent(ev);
      setPlayer(p);
      setGames(gs);
      setInterests(p.interests as Record<string, InterestLevel>);
      setCanExplain(p.canExplain);
      setRepeatGameIds(p.repeatGameIds ?? []);
      setLoading(false);
      localStorage.setItem(STORAGE_KEY(code), ticketCode!);
      savePlayerEvent({ code, ticketCode: ticketCode!, name: ev.name, date: ev.date, playerName: p.name });
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    if (!player) return;
    const unsub = subscribeTables(code, (ts) => setMyTables(getPlayerTables(player.id, ts)));
    return unsub;
  }, [code, player]);

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

  async function handleAddGame() {
    if (!player || !newGame.name.trim() || addingGame) return;
    setAddingGame(true);
    try {
      if (editingGameId) {
        await updateGame(code, editingGameId, newGame);
        setGames((gs) => gs.map((g) => (g.id === editingGameId ? { ...g, ...newGame } : g)));
        const updatedCanExplain = canExplainNew
          ? [...new Set([...canExplain, editingGameId])]
          : canExplain.filter((id) => id !== editingGameId);
        setCanExplain(updatedCanExplain);
        await updatePlayerWishlist(code, player.id, { interests, canExplain: updatedCanExplain, repeatGameIds });
      } else {
        const gameId = await addPlayerGame(code, player.id, player.name, player.bringGameIds, newGame);
        const createdGame: Game = { id: gameId, ...newGame, ownerPlayerId: player.id, ownerName: player.name };
        const updatedCanExplain = canExplainNew ? [...canExplain, gameId] : canExplain;
        setGames((gs) => [...gs, createdGame]);
        setPlayer((p) => p ? { ...p, bringGameIds: [...p.bringGameIds, gameId] } : p);
        setCanExplain(updatedCanExplain);
        await updatePlayerWishlist(code, player.id, { interests, canExplain: updatedCanExplain, repeatGameIds });
      }
      setNewGame(EMPTY_DRAFT_GAME);
      setCanExplainNew(false);
      setEditingGameId(null);
      setShowAddGame(false);
    } finally {
      setAddingGame(false);
    }
  }

  function startEditGame(game: Game) {
    setEditingGameId(game.id);
    setNewGame({
      name: game.name, bggUrl: game.bggUrl, minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers, durationMinutes: game.durationMinutes, complexity: game.complexity,
    });
    setCanExplainNew(canExplain.includes(game.id));
    setShowAddGame(true);
  }

  function cancelEditGame() {
    setEditingGameId(null);
    setNewGame(EMPTY_DRAFT_GAME);
    setCanExplainNew(false);
    setShowAddGame(false);
  }

  async function handleRemoveGame(gameId: string) {
    if (!player || removingGameId) return;
    if (!confirm('¿Eliminar este juego de tu lista? Se borrarán los votos que otros jugadores hicieron sobre él.')) return;
    setRemovingGameId(gameId);
    try {
      await removePlayerGame(code, player.id, gameId);
      setGames((gs) => gs.filter((g) => g.id !== gameId));
      setPlayer((p) => p ? { ...p, bringGameIds: p.bringGameIds.filter((id) => id !== gameId) } : p);
      setCanExplain((ids) => ids.filter((id) => id !== gameId));
      setRepeatGameIds((ids) => ids.filter((id) => id !== gameId));
      setInterests((cur) => {
        const next = { ...cur };
        delete next[gameId];
        return next;
      });
      if (editingGameId === gameId) cancelEditGame();
    } finally {
      setRemovingGameId(null);
    }
  }

  async function saveWishlist() {
    if (!player) return;
    setSaving(true);
    await updatePlayerWishlist(code, player.id, { interests, canExplain, repeatGameIds });
    // Fire-and-forget: don't make the player wait on the scheduling algorithm.
    if (event?.settings.autoGenerate) runTableGeneration(code, event).catch(() => {});
    setSaving(false);
  }

  function startEditTimes() {
    if (!player) return;
    setDraftArrival(player.arrivalTime);
    setDraftDeparture(player.departureTime);
    setEditingTimes(true);
  }

  async function saveTimes() {
    if (!player || savingTimes) return;
    setSavingTimes(true);
    try {
      await updatePlayerTimes(code, player.id, draftArrival, draftDeparture);
      setPlayer((p) => p ? { ...p, arrivalTime: draftArrival, departureTime: draftDeparture } : p);
      setEditingTimes(false);
      // Fire-and-forget: availability changed, so tables may need to be reshuffled.
      if (event?.settings.autoGenerate) runTableGeneration(code, event).catch(() => {});
    } finally {
      setSavingTimes(false);
    }
  }

  function toggleCanExplain(gameId: string) {
    setCanExplain((cur) => cur.includes(gameId) ? cur.filter((id) => id !== gameId) : [...cur, gameId]);
  }

  function toggleRepeatInterest(gameId: string) {
    setRepeatGameIds((cur) => cur.includes(gameId) ? cur.filter((id) => id !== gameId) : [...cur, gameId]);
  }

  function copyCode() {
    if (!player) return;
    navigator.clipboard.writeText(player.ticketCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const myGames = games.filter((g) => g.ownerPlayerId === player.id);
  const gameLimit = event.settings.maxGamesPerPlayer;
  const atGameLimit = gameLimit != null && player.bringGameIds.length >= gameLimit;
  // Merged duplicates (admin marked two entries as copies of the same game) only get one votable
  // row — the primary — combining every copy's owner name into a single label below.
  const primaryGames = games.filter((g) => !g.groupId || g.groupId === g.id);
  const copiesOf = (g: Game) => games.filter((m) => (m.groupId ?? m.id) === g.id);
  const ownerLabel = (g: Game) => copiesOf(g).map((m) => m.ownerName).join(', ');
  const isOwnGroup = (g: Game) => copiesOf(g).some((m) => m.ownerPlayerId === player.id);
  // Own games are votable too — the scheduling algorithm only seats players who voted must/casual on a game.
  const wishlistGames = primaryGames.filter((g) => interests[g.id] === 'must' || interests[g.id] === 'casual');
  // Unvoted games stay on top; "no"-voted games are collapsed into a separate section below.
  const availableGames = primaryGames
    .filter((g) => interests[g.id] !== 'must' && interests[g.id] !== 'casual' && interests[g.id] !== 'no');
  const dismissedGames = primaryGames.filter((g) => interests[g.id] === 'no');
  const confirmedTables = myTables
    .filter((t) => ['confirmed', 'in-progress', 'proposed'].includes(t.status))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const statusBadge: Record<string, string> = {
    confirmed: 'bg-green-900 text-green-300',
    'in-progress': 'bg-yellow-900 text-yellow-300',
    proposed: 'bg-gray-700 text-gray-300',
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="max-w-sm mx-auto space-y-6">
        <div className="text-center">
          <p className="text-sm text-gray-500 mb-1">{event.name}</p>
          <p className="text-4xl font-mono font-bold tracking-widest text-indigo-400">
            {player.ticketCode}
          </p>
          <button onClick={copyCode} className="text-xs text-gray-500 mt-1 hover:text-indigo-400">
            {copied ? '✓ Copiado' : 'Copiar código'}
          </button>
          <p className="text-sm mt-2 text-gray-400">
            Hola, <strong>{player.name}</strong> · {player.arrivalTime}–{player.departureTime}
          </p>
          {!editingTimes ? (
            <button onClick={startEditTimes} className="block mx-auto text-xs text-indigo-400 hover:underline mt-0.5">
              ✏️ Editar horario
            </button>
          ) : (
            <div className="mt-2 border border-gray-700 rounded-xl p-3 bg-gray-800 space-y-2 text-left">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400">Llego</label>
                  <TimeWheelPicker value={draftArrival} onChange={setDraftArrival}
                    minTime={event.startTime} maxTime={event.endTime} />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Me voy</label>
                  <TimeWheelPicker value={draftDeparture} onChange={setDraftDeparture}
                    minTime={event.startTime} maxTime={event.endTime} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditingTimes(false)}
                  className="flex-1 border border-gray-700 rounded-lg py-1.5 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={saveTimes} disabled={savingTimes}
                  className="flex-1 bg-indigo-600 rounded-lg py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                  {savingTimes ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
          {event.location && (
            <p className="text-sm text-gray-400 mt-1">📍 {event.location}</p>
          )}
          {event.mapUrl && (
            <a href={event.mapUrl} target="_blank" rel="noopener noreferrer"
              className="text-indigo-400 text-sm hover:underline inline-block mt-1">
              Ver ubicación en el mapa →
            </a>
          )}
        </div>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">Tus mesas <TablesHelp /></h2>
          {confirmedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía no tenés mesas asignadas. Las verás aparecer acá en tiempo real.
            </p>
          ) : (
            <div className="space-y-2">
              {confirmedTables.map((t) => {
                const isPlaying = t.playerIds.includes(player.id);
                const isExplainer = t.explainerId === player.id;
                const teachOnly = isExplainer && !isPlaying;
                const displayStart = t.startTime;
                const displayEnd = teachOnly
                  ? toTimeString(toMinutes(t.startTime) + TEACH_ONLY_MINUTES)
                  : t.endTime;
                return (
                  <div key={t.id} className="border border-gray-700 rounded-xl px-4 py-3 bg-gray-800">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{t.gameName}</span>
                      <span className={'text-xs px-2 py-0.5 rounded-full ' + (statusBadge[t.status] ?? 'bg-gray-700 text-gray-300')}>
                        {t.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400">Mesa {t.tableNumber} · {displayStart}–{displayEnd}</p>
                    <div className="flex gap-1 mt-1">
                      {isPlaying && (
                        <span className="text-xs bg-indigo-900 text-indigo-300 px-1.5 rounded">🎲 Jugador</span>
                      )}
                      {isExplainer && (
                        <span className="text-xs bg-purple-900 text-purple-300 px-1.5 rounded">
                          🎓 Explicador{teachOnly ? ' (explica y se va)' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Link href={`/event/${code}/board`}
            onClick={() => sessionStorage.setItem(BOARD_RETURN_KEY(code), `/event/${code}/me?ticket=${player.ticketCode}`)}
            className="block text-center mt-3 text-sm border border-gray-700 rounded-xl py-2 hover:bg-gray-800">
            📺 Ver grilla completa
          </Link>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Link href={`/event/${code}/votes`}
              className="text-center text-sm border border-gray-700 rounded-xl py-2 hover:bg-gray-800">
              📊 Votos totales
            </Link>
            <Link href={`/event/${code}/roster`}
              className="text-center text-sm border border-gray-700 rounded-xl py-2 hover:bg-gray-800">
              👥 Ver inscriptos
            </Link>
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">Tus juegos</h2>
          {myGames.length > 0 && (
            <div className="space-y-2 mb-3">
              {myGames.map((g) => (
                <div key={g.id} className="border border-gray-700 rounded-xl px-3 py-2 bg-gray-800 text-sm flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{g.minPlayers}–{g.maxPlayers}p · {COMPLEXITY_LABEL[g.complexity]}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => startEditGame(g)} className="text-xs text-indigo-400 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => handleRemoveGame(g.id)} disabled={removingGameId === g.id}
                      className="text-xs text-red-400 hover:underline disabled:opacity-40">
                      {removingGameId === g.id ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {editingGameId ? null : atGameLimit ? (
            <p className="text-xs text-amber-400">Llegaste al máximo de {event.settings.maxGamesPerPlayer} juegos para este evento.</p>
          ) : !showAddGame ? (
            <button onClick={() => setShowAddGame(true)}
              className="w-full border border-gray-700 rounded-xl py-2 text-sm font-medium hover:bg-gray-800">
              + Agregar otro juego
            </button>
          ) : null}
          {showAddGame && (
            <div className="space-y-3 border border-gray-700 rounded-xl p-4 bg-gray-800">
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
                <button onClick={cancelEditGame}
                  className="flex-1 border border-gray-700 rounded-lg py-2 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleAddGame} disabled={!newGame.name.trim() || addingGame}
                  className="flex-1 bg-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-600 disabled:opacity-40">
                  {addingGame ? 'Guardando...' : editingGameId ? '💾 Guardar juego' : '+ Agregar juego'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section>
        <h2 className="font-semibold text-gray-200 mb-1">Votá los juegos <VotingHelp /></h2>
        <WhyVoteHelp />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Juegos disponibles</h3>
            <div className="space-y-2">
              {availableGames.map((g) => (
                <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={isOwnGroup(g)} ownerLabel={ownerLabel(g)}
                  onSetInterest={(level) => setInterests({ ...interests, [g.id]: level })}
                  canExplain={canExplain.includes(g.id)} onToggleCanExplain={() => toggleCanExplain(g.id)}
                  repeatInterest={repeatGameIds.includes(g.id)} onToggleRepeatInterest={() => toggleRepeatInterest(g.id)} />
              ))}
            </div>
            {dismissedGames.length > 0 && (
              <div className="mt-3">
                <button onClick={() => setShowDismissed((v) => !v)}
                  className="text-xs text-gray-500 hover:text-gray-300">
                  {showDismissed ? '▾' : '▸'} Ocultados ({dismissedGames.length})
                </button>
                {showDismissed && (
                  <div className="space-y-2 mt-2">
                    {dismissedGames.map((g) => (
                      <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={isOwnGroup(g)} ownerLabel={ownerLabel(g)}
                        onSetInterest={(level) => setInterests({ ...interests, [g.id]: level })}
                        canExplain={canExplain.includes(g.id)} onToggleCanExplain={() => toggleCanExplain(g.id)}
                        repeatInterest={repeatGameIds.includes(g.id)} onToggleRepeatInterest={() => toggleRepeatInterest(g.id)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">❤️ Tu wishlist</h3>
            {wishlistGames.length === 0 ? (
              <p className="text-xs text-gray-500">Todavía no elegiste ningún juego. Votá desde “Juegos disponibles” ←</p>
            ) : (
              <div className="space-y-2">
                {wishlistGames.map((g) => (
                  <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={isOwnGroup(g)} ownerLabel={ownerLabel(g)}
                    onSetInterest={(level) => setInterests({ ...interests, [g.id]: level })}
                    canExplain={canExplain.includes(g.id)} onToggleCanExplain={() => toggleCanExplain(g.id)}
                    repeatInterest={repeatGameIds.includes(g.id)} onToggleRepeatInterest={() => toggleRepeatInterest(g.id)} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-4 flex justify-end pt-4">
          <button onClick={saveWishlist} disabled={saving}
            className="bg-indigo-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold shadow-lg shadow-black/40 hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Guardando...' : '💾 Guardar cambios'}
          </button>
        </div>
      </section>
    </main>
  );
}

function GameVoteCard({
  game, interest, isOwn, ownerLabel, onSetInterest, canExplain, onToggleCanExplain, repeatInterest, onToggleRepeatInterest,
}: {
  game: Game;
  interest: InterestLevel | undefined;
  isOwn: boolean;
  ownerLabel: string;
  onSetInterest: (level: InterestLevel) => void;
  canExplain: boolean;
  onToggleCanExplain: () => void;
  repeatInterest: boolean;
  onToggleRepeatInterest: () => void;
}) {
  const copyCount = ownerLabel.split(',').length;
  return (
    <div className="border border-gray-700 rounded-xl px-3 py-2 bg-gray-800">
      <div className="flex justify-between items-start mb-1">
        <span className="font-medium text-sm">
          {game.name}{isOwn && <span className="text-indigo-400 font-normal"> · lo traés vos</span>}
          {copyCount > 1 && <span className="ml-1 text-[10px] bg-indigo-900 text-indigo-300 px-1 rounded">🧩 {copyCount} copias</span>}
        </span>
        <span className="text-xs text-gray-500">{game.minPlayers}–{game.maxPlayers}p · {COMPLEXITY_LABEL[game.complexity]}</span>
      </div>
      {!isOwn && <p className="text-[11px] text-gray-500 mb-1">Trae: {ownerLabel}</p>}
      <a href={game.bggUrl ?? bggSearchUrl(game.name)} target="_blank" rel="noopener noreferrer"
        className="text-[11px] text-indigo-400 hover:underline inline-block mb-2">
        {game.bggUrl ? '🎲 Ver en BGG' : '🎲 Buscar en BGG'}
      </a>
      <div className="flex gap-1 mt-1">
        {(['must', 'casual', 'no'] as InterestLevel[]).map((level) => {
          const active = interest === level;
          const cls = active
            ? level === 'must' ? 'bg-red-900 border-red-600 text-red-300'
              : level === 'casual' ? 'bg-blue-900 border-blue-600 text-blue-300'
              : 'bg-gray-700 border-gray-500 text-gray-300'
            : 'border-gray-700 text-gray-500 hover:bg-gray-800';
          return (
            <button key={level}
              onClick={() => onSetInterest(level)}
              className={'flex-1 py-1 text-[11px] rounded-lg border transition-colors ' + cls}>
              {level === 'must' ? '❤️' : level === 'casual' ? '👍' : '👎'}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-gray-400 mt-2">
        <input type="checkbox" checked={canExplain} onChange={onToggleCanExplain} />
        Sé explicarlo
      </label>
      {(interest === 'must' || interest === 'casual') && (
        <label className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
          <input type="checkbox" checked={repeatInterest} onChange={onToggleRepeatInterest} />
          Me sumaría a una segunda mesa de este juego
        </label>
      )}
    </div>
  );
}
