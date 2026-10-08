'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, autoMergeDuplicates,
  updatePlayerWishlist, subscribeTables, getPlayerTables, addPlayerGame, updateGame, removePlayerGame, updatePlayerTimes,
  postTable,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { toMinutes, toTimeString, roundUp5 } from '@/lib/timeUtils';
import { BOARD_RETURN_KEY } from '@/lib/boardReturn';
import { savePlayerEvent } from '@/lib/myEvents';
import { searchBgg, getBggGameDetails, isBggUrl, type BggSearchResult } from '@/lib/bgg';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';
import TablesHelp from '@/components/ui/TablesHelp';
import HelpPopover from '@/components/ui/HelpPopover';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Player, Game, Table, GameComplexity, DraftGame } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

type InterestLevel = 'yes' | 'no';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Liviano',
  medium: 'Intermedio',
  heavy: 'Pesado',
};

const EMPTY_DRAFT_GAME: DraftGame = {
  name: '', bggUrl: null, imageUrl: null, minPlayers: 2, maxPlayers: 4, durationMinutes: 60, complexity: 'medium',
  perPlayerMinutes: null, setupMinutes: null, explanationMinutes: null,
};

export default function MyTicketPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [myTables, setMyTables] = useState<Table[]>([]);
  const [interests, setInterests] = useState<Record<string, InterestLevel>>({});
  const [canExplain, setCanExplain] = useState<string[]>([]);
  const [playedGameIds, setPlayedGameIds] = useState<string[]>([]);
  const [repeatGameIds, setRepeatGameIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showAddGame, setShowAddGame] = useState(false);
  const [newGame, setNewGame] = useState<DraftGame>(EMPTY_DRAFT_GAME);
  const [newGameKnowledgeLevel, setNewGameKnowledgeLevel] = useState<KnowledgeLevel | null>(null);
  const [bggSuggested, setBggSuggested] = useState<{ perPlayerMinutes: number } | null>(null);
  const [addGameStep, setAddGameStep] = useState(1);
  const [addingGame, setAddingGame] = useState(false);
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [editingTimes, setEditingTimes] = useState(false);
  const [draftArrival, setDraftArrival] = useState('');
  const [draftDeparture, setDraftDeparture] = useState('');
  const [savingTimes, setSavingTimes] = useState(false);
  const [proposingGameId, setProposingGameId] = useState<string | null>(null);
  const [proposeStart, setProposeStart] = useState('');
  const [proposingSubmitting, setProposingSubmitting] = useState(false);
  const [proposeError, setProposeError] = useState('');
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
      if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); router.replace('/event/' + code); return; }
      setEvent(ev);
      setPlayer(p);
      setGames(gs);
      setInterests(p.interests as Record<string, InterestLevel>);
      setCanExplain(p.canExplain);
      setPlayedGameIds(p.playedGameIds ?? []);
      setRepeatGameIds(p.repeatGameIds ?? []);
      setLoading(false);
      localStorage.setItem(STORAGE_KEY(code), ticketCode!);
      savePlayerEvent({ code, ticketCode: ticketCode!, name: ev.name, date: ev.date, playerName: p.name });
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    if (!player) return;
    const unsub = subscribeTables(code, (ts) => { setAllTables(ts); setMyTables(getPlayerTables(player.id, ts)); });
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
      // BGG only gives one lump playtime figure, with no breakdown for setup/explanation — dividing
      // it across max players is just a starting point for "time per player" the organizer can adjust.
      const suggestedPerPlayer = Math.max(5, roundUp5(details.durationMinutes / Math.max(1, details.boxMaxPlayers)));
      setNewGame((g) => ({
        ...g,
        name: result.name,
        bggUrl: details.bggUrl,
        imageUrl: details.imageUrl,
        minPlayers: details.minPlayers,
        maxPlayers: details.maxPlayers,
        durationMinutes: details.durationMinutes,
        complexity: details.complexity,
        perPlayerMinutes: suggestedPerPlayer,
      }));
      setBggSuggested({ perPlayerMinutes: suggestedPerPlayer });
      setAddGameStep(1);
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
      // No flat duration input anymore — falls back to a pessimistic estimate (setup + explanation +
      // per-player time × max players) so the game still has a usable durationMinutes for display/legacy code.
      const estimatedDurationMinutes = roundUp5((newGame.setupMinutes ?? 0) + (newGame.explanationMinutes ?? 0) + (newGame.perPlayerMinutes ?? 0) * newGame.maxPlayers);
      const gameToSave: DraftGame = { ...newGame, durationMinutes: estimatedDurationMinutes || newGame.durationMinutes };
      if (editingGameId) {
        await updateGame(code, editingGameId, gameToSave);
        setGames((gs) => gs.map((g) => (g.id === editingGameId ? { ...g, ...gameToSave } : g)));
        const gid = editingGameId;
        const without = (ids: string[]) => ids.filter((id) => id !== gid);
        const nextCanExplain = newGameKnowledgeLevel === 'explains' ? [...without(canExplain), gid] : without(canExplain);
        const nextPlayed = newGameKnowledgeLevel === 'knows' ? [...without(playedGameIds), gid] : without(playedGameIds);
        setCanExplain(nextCanExplain);
        setPlayedGameIds(nextPlayed);
        await updatePlayerWishlist(code, player.id, {
          interests, canExplain: nextCanExplain, playedGameIds: nextPlayed, repeatGameIds,
        });
      } else {
        const gameId = await addPlayerGame(code, player.id, player.name, player.bringGameIds, gameToSave);
        const createdGame: Game = { id: gameId, ...gameToSave, ownerPlayerId: player.id, ownerName: player.name };
        setGames((gs) => [...gs, createdGame]);
        setPlayer((p) => p ? { ...p, bringGameIds: [...p.bringGameIds, gameId] } : p);

        // Whoever brings a game is assumed to want to play it (a 👍 on their own game), plus their
        // knowledge level for it, all resolved in this one step.
        const nextInterests = { ...interests, [gameId]: 'yes' as InterestLevel };
        const nextCanExplain = newGameKnowledgeLevel === 'explains' ? [...canExplain, gameId] : canExplain;
        const nextPlayed = newGameKnowledgeLevel === 'knows' ? [...playedGameIds, gameId] : playedGameIds;
        setInterests(nextInterests);
        setCanExplain(nextCanExplain);
        setPlayedGameIds(nextPlayed);
        await updatePlayerWishlist(code, player.id, {
          interests: nextInterests, canExplain: nextCanExplain, playedGameIds: nextPlayed, repeatGameIds,
        });

        // If someone else already brought this same BGG game, link the copies together (after the
        // votes above are saved, so they get folded onto the primary copy) and reload local state
        // so later saves don't write back votes keyed on a now-secondary copy.
        if (gameToSave.bggUrl) {
          await autoMergeDuplicates(code, 'bggUrl');
          const [gs, fresh] = await Promise.all([getGames(code), getPlayerByTicketCode(code, player.ticketCode)]);
          setGames(gs);
          if (fresh) {
            setInterests(fresh.interests as Record<string, InterestLevel>);
            setCanExplain(fresh.canExplain);
            setPlayedGameIds(fresh.playedGameIds ?? []);
            setRepeatGameIds(fresh.repeatGameIds ?? []);
          }
        }
      }
      setNewGame(EMPTY_DRAFT_GAME);
      setNewGameKnowledgeLevel(null);
      setBggSuggested(null);
      setAddGameStep(1);
      setEditingGameId(null);
      setShowAddGame(false);
    } finally {
      setAddingGame(false);
    }
  }

  function startEditGame(game: Game) {
    skipBggSearchRef.current = true;
    setEditingGameId(game.id);
    setNewGame({
      name: game.name, bggUrl: game.bggUrl, imageUrl: game.imageUrl ?? null, minPlayers: game.minPlayers,
      maxPlayers: game.maxPlayers, durationMinutes: game.durationMinutes, complexity: game.complexity,
      lendable: !!game.lendable,
      perPlayerMinutes: game.perPlayerMinutes ?? null, setupMinutes: game.setupMinutes ?? null, explanationMinutes: game.explanationMinutes ?? null,
    });
    setNewGameKnowledgeLevel(canExplain.includes(game.id) ? 'explains' : playedGameIds.includes(game.id) ? 'knows' : 'never');
    setShowAddGame(true);
  }

  function cancelEditGame() {
    setEditingGameId(null);
    setNewGame(EMPTY_DRAFT_GAME);
    setNewGameKnowledgeLevel(null);
    setBggSuggested(null);
    setAddGameStep(1);
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
      setPlayedGameIds((ids) => ids.filter((id) => id !== gameId));
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
      if (event) runTableGeneration(code, event).catch(() => {});
    } finally {
      setSavingTimes(false);
    }
  }

  // A player is free for a window if it fits their own arrival/departure and doesn't overlap
  // (with buffer) any table they're already seated at or explaining.
  function isPlayerFreeFor(start: string, end: string): boolean {
    if (!player || !event) return false;
    const buf = event.settings.bufferMinutes;
    const sMin = toMinutes(start);
    const eMin = toMinutes(end);
    if (sMin < toMinutes(player.arrivalTime) + buf || eMin > toMinutes(player.departureTime)) return false;
    return myTables.every((t) => toMinutes(t.endTime) + buf <= sMin || eMin + buf <= toMinutes(t.startTime));
  }

  function openProposeForm(gameId: string) {
    setProposeError('');
    setProposeStart('');
    setProposingGameId((cur) => cur === gameId ? null : gameId);
  }

  // Owner posts a table directly at a time of their choosing — starts 'recommended' (waiting for
  // players to join up to the game's minimum), unless the owner alone already meets it.
  async function submitPropose(game: Game) {
    if (!player || !event || !proposeStart || proposingSubmitting) return;
    // The poster is the table's explainer, so they have to know how to teach the game. Votes and
    // knowledge live on the primary copy when games are merged.
    const primaryId = game.groupId ?? game.id;
    if (!canExplain.includes(primaryId)) {
      setProposeError('Para proponer una mesa tenés que saber explicar el juego.');
      return;
    }
    const start = proposeStart;
    const end = toTimeString(toMinutes(start) + roundUp5(game.durationMinutes));
    if (!isPlayerFreeFor(start, end)) {
      setProposeError('Ese horario se te superpone con otra mesa tuya (o no entra en tu horario).');
      return;
    }
    setProposingSubmitting(true);
    setProposeError('');
    try {
      const nextTableNumber = allTables.length ? Math.max(...allTables.map((t) => t.tableNumber)) + 1 : 1;
      const latestBatch = allTables.length ? Math.max(...allTables.map((t) => t.batchNumber)) : 1;
      await postTable(code, {
        gameId: primaryId, gameName: game.name, startTime: start, endTime: end,
        explainerId: player.id, playerIds: [player.id],
        status: game.minPlayers <= 1 ? 'confirmed' : 'recommended', postedByOwner: true,
        isManuallyEdited: false, batchNumber: latestBatch, tableNumber: nextTableNumber,
      });
      setProposingGameId(null);
      setProposeStart('');
    } finally {
      setProposingSubmitting(false);
    }
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
  const coverFor = (gameId: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={games.find((g) => g.id === gameId)?.imageUrl || '/cover-placeholder.png'} alt=""
      className="w-9 h-11 rounded object-cover border border-gray-700 bg-gray-900 shrink-0" />
  );
  const inStep = (n: number) => !!editingGameId || addGameStep === n;
  const timingFilled = newGame.perPlayerMinutes != null && newGame.setupMinutes != null && newGame.explanationMinutes != null;
  const gameLimit = event.settings.maxGamesPerPlayer;
  const atGameLimit = gameLimit != null && player.bringGameIds.length >= gameLimit;

  // The real schedule — only tables that actually happen. Pending states (recommended, either
  // algorithm- or owner-driven) have their own dedicated pages instead of mixing in here.
  const confirmedTables = myTables
    .filter((t) => ['confirmed', 'in-progress'].includes(t.status))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const statusLabel: Record<string, string> = { confirmed: 'Confirmada', 'in-progress': 'En curso' };
  const statusBadge: Record<string, string> = {
    confirmed: 'bg-green-900 text-green-300',
    'in-progress': 'bg-yellow-900 text-yellow-300',
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
          <div className="flex justify-center gap-2 mt-3">
            <Link href={`/event/${code}/roster`}
              className="text-center text-sm border border-gray-700 rounded-xl px-3 py-1.5 hover:bg-gray-800">
              👥 Ver inscriptos
            </Link>
            <Link href={`/event/${code}/organizers?ticket=${player.ticketCode}`}
              className="text-center text-sm border border-gray-700 rounded-xl px-3 py-1.5 hover:bg-gray-800">
              🧑‍💼 Organizadores
            </Link>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <section className="border-t border-gray-800 pt-6">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="font-semibold text-gray-200">🎲 Tus mesas <TablesHelp /></h2>
            <Link href={`/event/${code}/board?ticket=${player.ticketCode}`}
              onClick={() => sessionStorage.setItem(BOARD_RETURN_KEY(code), `/event/${code}/me?ticket=${player.ticketCode}`)}
              className="flex items-center gap-1 text-sm border border-gray-700 rounded-xl px-3 py-1.5 hover:bg-gray-800 shrink-0">
              <span>📺 Ver grilla completa</span>
              <HelpPopover title="📺 Ver grilla completa">
                <p>Te lleva a la grilla horaria de todo el evento, con las mesas ya confirmadas de todos los jugadores. Desde ahí también podés sumarte a mesas recomendadas o postuladas con un toque.</p>
              </HelpPopover>
            </Link>
          </div>
          {confirmedTables.length === 0 ? (
            <div className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 space-y-2 text-left">
              <p>Todavía no tenés mesas confirmadas.</p>
              <p>
                Cuando votás tus intereses, el algoritmo busca otros inscriptos con los mismos intereses y te
                propone una mesa en un horario en el que coincidan. Vas a encontrar esa propuesta
                en <strong className="text-gray-300">Mesas recomendadas</strong>, donde podés aceptarla o
                rechazarla. Una vez que la aceptás, aparece acá como confirmada.
              </p>
              <p>
                También podés revisar las mesas que postularon otros inscriptos
                en <strong className="text-gray-300">Mesas postuladas</strong> y anotarte. Cuando la mesa junta el
                mínimo de jugadores necesario, también aparece acá como confirmada.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {confirmedTables.map((t) => {
                const isPlaying = t.playerIds.includes(player.id);
                const isExplainer = t.explainerId === player.id;
                return (
                  <div key={t.id} className="border border-gray-700 rounded-xl px-4 py-3 bg-gray-800">
                    <div className="flex justify-between items-start gap-2">
                      <span className="flex items-center gap-2 min-w-0">
                        {coverFor(t.gameId)}
                        <span className="font-medium">{t.gameName}</span>
                      </span>
                      <span className={'text-xs px-2 py-0.5 rounded-full shrink-0 ' + (statusBadge[t.status] ?? 'bg-gray-700 text-gray-300')}>
                        {statusLabel[t.status] ?? t.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-1">Mesa {t.tableNumber} · {t.startTime}–{t.endTime}</p>
                    <div className="flex gap-1 mt-1">
                      {isPlaying && (
                        <span className="text-xs bg-indigo-900 text-indigo-300 px-1.5 rounded">🎲 Jugador</span>
                      )}
                      {isExplainer && (
                        <span className="text-xs bg-purple-900 text-purple-300 px-1.5 rounded">🎓 Explicador</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Link href={`/event/${code}/recommended?ticket=${player.ticketCode}`}
              className="flex items-center justify-center gap-1.5 text-sm border border-amber-800 text-amber-300 rounded-xl px-2 py-2 hover:bg-amber-950/30">
              <span>🟡 Mesas recomendadas</span>
              <HelpPopover title="🟡 Mesas recomendadas">
                <p>El algoritmo arma mesas según tus votos y te ofrece un lugar en ellas.</p>
                <p>Ahí las podés aceptar o rechazar, y también es donde votás qué juegos te interesan.</p>
              </HelpPopover>
            </Link>
            <Link href={`/event/${code}/postulated?ticket=${player.ticketCode}`}
              className="flex items-center justify-center gap-1.5 text-sm border border-purple-800 text-purple-300 rounded-xl px-2 py-2 hover:bg-purple-950/30">
              <span>📣 Mesas postuladas</span>
              <HelpPopover title="📣 Mesas postuladas">
                <p>Acá vas a ver las mesas que vos mismo postulaste, y las que postularon otros jugadores para sumarte con un toque.</p>
                <p>Cuando una mesa junta el mínimo de jugadores necesario, se confirma sola.</p>
              </HelpPopover>
            </Link>
          </div>
        </section>

        <section className="border-t border-gray-800 pt-6">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="font-semibold text-gray-200">♟️ Tus juegos</h2>
            <Link href={`/event/${code}/games?ticket=${player.ticketCode}`}
              className="flex items-center gap-1 text-sm border border-gray-700 rounded-xl px-3 py-1.5 hover:bg-gray-800 shrink-0">
              <span>🎲 Juegos de todos</span>
              <HelpPopover title="🎲 Juegos de todos">
                <p>Te lleva a la lista completa de juegos del evento (los tuyos y los de los demás), para que puedas votar tus intereses.</p>
              </HelpPopover>
            </Link>
          </div>
          {myGames.length > 0 && (
            <div className="space-y-2 mb-3">
              {myGames.map((g) => (
                <div key={g.id} className="border border-gray-700 rounded-xl px-3 py-2 bg-gray-800 text-sm">
                  <div className="min-w-0 mb-2 flex items-center gap-2">
                    {coverFor(g.id)}
                    <div className="min-w-0">
                      <span className="font-medium">{g.name}</span>
                      <p className="text-[11px] text-gray-500 mt-0.5">{g.minPlayers}–{g.maxPlayers}p · {roundUp5(g.durationMinutes)}min ·{COMPLEXITY_LABEL[g.complexity]}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => openProposeForm(g.id)}
                      className="relative flex-1 py-1.5 rounded-lg border border-amber-800 text-amber-400 hover:bg-amber-950/30 flex flex-col items-center gap-0.5 leading-tight">
                      <span className="absolute top-0.5 right-0.5">
                        <HelpPopover title="📣 Proponer mesa">
                          <p>Elegís vos el horario para armar esta mesa — otros jugadores se pueden sumar hasta llegar al mínimo necesario.</p>
                        </HelpPopover>
                      </span>
                      <span className="text-sm">📣</span>
                      <span className="text-[10px]">Proponer mesa</span>
                    </button>
                    <button onClick={() => startEditGame(g)}
                      className="flex-1 py-1.5 rounded-lg border border-gray-700 text-indigo-400 hover:bg-gray-800 flex flex-col items-center gap-0.5 leading-tight">
                      <span className="text-sm">✏️</span>
                      <span className="text-[10px]">Editar</span>
                    </button>
                    <button onClick={() => handleRemoveGame(g.id)} disabled={removingGameId === g.id}
                      className="flex-1 py-1.5 rounded-lg border border-gray-700 text-red-400 hover:bg-gray-800 disabled:opacity-40 flex flex-col items-center gap-0.5 leading-tight">
                      <span className="text-sm">🗑️</span>
                      <span className="text-[10px]">{removingGameId === g.id ? 'Eliminando...' : 'Eliminar'}</span>
                    </button>
                  </div>
                  {proposingGameId === g.id && (
                    <div className="mt-2 border-t border-gray-700 pt-2 space-y-2">
                      {!canExplain.includes(g.groupId ?? g.id) ? (
                        <>
                          <p className="text-xs text-amber-300">
                            Para proponer una mesa tenés que saber explicar el juego, porque vos sos quien lo explica en la mesa.
                            Editalo y elegí “🎓 Sé explicarlo” en “¿Qué tan bien lo conocés?”.
                          </p>
                          <div className="flex gap-2">
                            <button onClick={() => setProposingGameId(null)}
                              className="flex-1 border border-gray-700 rounded-lg py-1.5 text-xs font-medium">
                              Cerrar
                            </button>
                            <button onClick={() => { setProposingGameId(null); startEditGame(g); }}
                              className="flex-1 bg-indigo-600 rounded-lg py-1.5 text-xs font-medium hover:bg-indigo-700">
                              ✏️ Editar juego
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-gray-400">Elegí a qué hora arrancás a explicarlo — dura {roundUp5(g.durationMinutes)}min.</p>
                          <TimeWheelPicker value={proposeStart} onChange={setProposeStart}
                            minTime={player.arrivalTime} maxTime={player.departureTime} />
                          {proposeError && <p className="text-xs text-red-400">{proposeError}</p>}
                          <div className="flex gap-2">
                            <button onClick={() => setProposingGameId(null)}
                              className="flex-1 border border-gray-700 rounded-lg py-1.5 text-xs font-medium">
                              Cancelar
                            </button>
                            <button onClick={() => submitPropose(g)} disabled={!proposeStart || proposingSubmitting}
                              className="flex-1 bg-amber-600 rounded-lg py-1.5 text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
                              {proposingSubmitting ? 'Publicando...' : 'Publicar mesa'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {editingGameId ? null : atGameLimit ? (
            <p className="text-xs text-amber-400">Llegaste al máximo de {event.settings.maxGamesPerPlayer} juegos para este evento.</p>
          ) : !showAddGame ? (
            <button onClick={() => { setNewGame(EMPTY_DRAFT_GAME); setNewGameKnowledgeLevel(null); setBggSuggested(null); setAddGameStep(1); setShowAddGame(true); }}
              className="w-full border border-gray-700 rounded-xl py-2 text-sm font-medium hover:bg-gray-800">
              + Agregar otro juego
            </button>
          ) : null}
          {showAddGame && (
            <div className="space-y-3 border border-gray-700 rounded-xl p-4 bg-gray-800">
              {editingGameId ? (
                <h3 className="text-base font-semibold text-gray-100 flex items-center gap-2">🎲 {newGame.name}</h3>
              ) : (
              <div className="relative">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="11" cy="11" r="7" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input className="w-full border border-gray-700 bg-gray-900 rounded-lg pl-9 pr-3 py-2" placeholder="Buscar en BGG..."
                    value={newGame.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      if (!name) { setBggSuggested(null); setAddGameStep(1); }
                      setNewGame(name ? { ...newGame, name } : { ...newGame, name, imageUrl: null, bggUrl: null });
                    }}
                    onFocus={() => { if (bggResults.length > 0) setBggOpen(true); }}
                    onBlur={() => setTimeout(() => setBggOpen(false), 150)} />
                </div>
                {bggLoading && <p className="text-xs text-gray-500 mt-1">Buscando en BGG...</p>}
                {bggOpen && bggResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {bggResults.map((r) => (
                      <button key={r.id} type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectBggResult(r); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 flex items-center gap-2">
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.imageUrl} alt="" className="w-10 h-10 rounded object-cover border border-gray-700 shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-800 border border-gray-700 shrink-0 flex items-center justify-center text-lg text-gray-600">
                            🎲
                          </div>
                        )}
                        <span className="truncate flex-1">{r.name}</span>
                        {r.year && <span className="text-gray-500 text-xs shrink-0">{r.year}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}
              {newGame.imageUrl && (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={newGame.imageUrl} alt=""
                  className="w-full aspect-[41/50] rounded-md object-contain bg-gray-900 border border-gray-700" />
                <button type="button" onClick={() => { setNewGame({ ...newGame, imageUrl: null, bggUrl: null }); setBggSuggested(null); setAddGameStep(1); }}
                  aria-label="Quitar" title="Quitar"
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-gray-900/80 border border-gray-700 text-gray-300 hover:bg-gray-800 flex items-center justify-center text-sm">
                  ✕
                </button>
              </div>
              )}
              {isBggUrl(newGame.bggUrl) && (
                <a href={newGame.bggUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-base font-medium text-indigo-400 hover:underline text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/bgg-icon.png" alt="" className="w-5 h-5 shrink-0" />
                  {newGame.name}
                </a>
              )}
              {(isBggUrl(newGame.bggUrl) || editingGameId) && (
              <>
              <div className="space-y-3">
                {inStep(1) && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-200">⏱️ Tiempo de juego</h3>
                    <div>
                      <label className="text-xs text-gray-400">🛠️ ¿Cuánto tiempo de armado? (min)</label>
                      <input type="number" min={0} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                        value={newGame.setupMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder="—"
                        onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onChange={(e) => setNewGame({ ...newGame, setupMinutes: e.target.value ? +e.target.value : null })} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">📚 ¿Cuánto tiempo de explicación? (min)</label>
                      <input type="number" min={0} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm"
                        value={newGame.explanationMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder="—"
                        onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                        onChange={(e) => setNewGame({ ...newGame, explanationMinutes: e.target.value ? +e.target.value : null })} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">¿Cuánto tiempo por jugador? (min)</label>
                      <div className="relative">
                        <input type="number" min={0}
                          className="w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 pr-28 text-sm" placeholder="—"
                          value={newGame.perPlayerMinutes ?? ''} onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
                          onChange={(e) => setNewGame({ ...newGame, perPlayerMinutes: e.target.value ? +e.target.value : null })} />
                        {bggSuggested && newGame.perPlayerMinutes === bggSuggested.perPlayerMinutes && (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-indigo-400 pointer-events-none whitespace-nowrap">Recomendación BGG</span>
                        )}
                      </div>
                    </div>
                    {!editingGameId && (
                      <button type="button" onClick={() => setAddGameStep(2)} disabled={!timingFilled}
                        className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40">
                        Siguiente →
                      </button>
                    )}
                  </div>
                )}
              </div>
              {inStep(2) && (
                <>
                <h3 className={'text-sm font-semibold text-gray-200' + (editingGameId ? ' pt-3 border-t border-gray-700' : '')}>🎮 Preferencias</h3>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">¿Qué tan bien lo conocés?</label>
                  <KnowledgeLevelPicker value={newGameKnowledgeLevel} onChange={setNewGameKnowledgeLevel} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">🤝 ¿Prestás tu copia aunque no juegues esa mesa?</label>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setNewGame({ ...newGame, lendable: true })}
                      className={'flex-1 py-1.5 rounded-lg border text-sm font-medium ' + (newGame.lendable === true ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800')}>
                      Sí
                    </button>
                    <button type="button" onClick={() => setNewGame({ ...newGame, lendable: false })}
                      className={'flex-1 py-1.5 rounded-lg border text-sm font-medium ' + (newGame.lendable === false ? 'bg-gray-700 border-gray-600 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800')}>
                      No
                    </button>
                  </div>
                </div>
                </>
              )}
              {(!!editingGameId || addGameStep === 2) && (
              <>
              <div className="flex gap-2">
                {!editingGameId && (
                  <button type="button" onClick={() => setAddGameStep(1)} className="text-xs text-gray-500 hover:text-gray-300 px-2">← Volver</button>
                )}
                <button onClick={cancelEditGame}
                  className="flex-1 border border-gray-700 rounded-lg py-2 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleAddGame}
                  disabled={!newGame.name.trim() || newGame.perPlayerMinutes == null || newGame.setupMinutes == null || newGame.explanationMinutes == null || newGameKnowledgeLevel == null || newGame.lendable == null || addingGame}
                  className="flex-1 bg-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-600 disabled:opacity-40">
                  {addingGame ? 'Guardando...' : editingGameId ? '💾 Guardar juego' : '+ Agregar juego'}
                </button>
              </div>
              </>
              )}
              </>
              )}
            </div>
          )}
        </section>
      </div>

    </main>
  );
}
