'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables,
  respondToRecommendation, updatePlayerWishlist,
} from '@/lib/firestore';
import { estimatedDuration } from '@/lib/tableAlgorithm';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import { useAutoSaveWishlist } from '@/hooks/useAutoSaveWishlist';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import SaveStatusPill from '@/components/ui/SaveStatus';
import FilterChip from '@/components/ui/FilterChip';
import PushOptIn from '@/components/ui/PushOptIn';
import GameVoteCard from '@/components/ui/GameVoteCard';
import VotingHelp from '@/components/ui/VotingHelp';
import WhyVoteHelp from '@/components/ui/WhyVoteHelp';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Player, Game, Table, GameComplexity, InterestLevel } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

const COMPLEXITY_LABEL: Record<GameComplexity, string> = { light: 'Liviano', medium: 'Intermedio', heavy: 'Pesado' };

type TableFilter = 'pending' | 'waiting' | 'confirmed' | 'all';
type GameFilter = 'available' | 'wishlist' | 'hidden';

export default function RecommendedTablesPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [otherPlayers, setOtherPlayers] = useState<Player[]>([]);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTableId, setRespondingTableId] = useState<string | null>(null);
  const [repeatPromptGameId, setRepeatPromptGameId] = useState<string | null>(null);
  const [viewingTableId, setViewingTableId] = useState<string | null>(null);
  // Set once the player accepts a table: that's the moment to offer notifications about it
  const [acceptedOne, setAcceptedOne] = useState(false);
  // The table whose Aceptar opened the overlap popup (so its "Rechazar" knows which table to decline)
  const [acceptingTable, setAcceptingTable] = useState<Table | null>(null);
  const [interests, setInterests] = useState<Record<string, InterestLevel>>({});
  const [canExplain, setCanExplain] = useState<string[]>([]);
  const [playedGameIds, setPlayedGameIds] = useState<string[]>([]);
  // null = nothing picked yet, so the tables list opens on "Por aceptar" when something is pending
  const [tableFilter, setTableFilter] = useState<TableFilter | null>(null);
  const [gameFilter, setGameFilter] = useState<GameFilter>('available');
  const [knowledgePromptGameId, setKnowledgePromptGameId] = useState<string | null>(null);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? localStorage.getItem(STORAGE_KEY(code))) as string | null;
    if (!ticketCode) { router.replace('/event/' + code); return; }
    async function load() {
      const [ev, gs, ps] = await Promise.all([getEvent(code), getGames(code), getPlayers(code)]);
      const p = await getPlayerByTicketCode(code, ticketCode!);
      if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); router.replace('/event/' + code); return; }
      setEvent(ev);
      setPlayer(p);
      setGames(gs);
      setOtherPlayers(ps);
      setInterests(p.interests as Record<string, InterestLevel>);
      setCanExplain(p.canExplain);
      setPlayedGameIds(p.playedGameIds ?? []);
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    if (!player) return;
    const unsub = subscribeTables(code, setAllTables);
    return unsub;
  }, [code, player]);

  const { conflictPrompt, resolveScheduleConflict, handleConflictChoice } = useScheduleConflict(code, player, allTables);
  // Votes and knowledge levels save themselves a moment after the last change.
  const { status: saveStatus, retry: retrySave } = useAutoSaveWishlist(code, player?.id, event,
    player ? { interests, canExplain, playedGameIds, repeatGameIds: player.repeatGameIds ?? [] } : null);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const otherPlayerMap = new Map(otherPlayers.map((p) => [p.id, p]));
  const myId = player.id;

  // Merged duplicates (admin marked two entries as copies of the same game) only get one votable
  // row — the primary — combining every copy's owner name into a single label below.
  const primaryGames = games.filter((g) => !g.groupId || g.groupId === g.id);
  const copiesOf = (g: Game) => games.filter((m) => (m.groupId ?? m.id) === g.id);
  const ownerLabel = (g: Game) => copiesOf(g).map((m) => m.ownerName).join(', ');
  const isOwnGroup = (g: Game) => copiesOf(g).some((m) => m.ownerPlayerId === player.id);
  // Own games are votable too — the scheduling algorithm only seats players who voted yes on a game.
  const wishlistGames = primaryGames.filter((g) => interests[g.id] === 'yes');
  // Unvoted games stay on top; "no"-voted games are collapsed into a separate section below.
  const availableGames = primaryGames.filter((g) => interests[g.id] !== 'yes' && interests[g.id] !== 'no');
  const dismissedGames = primaryGames.filter((g) => interests[g.id] === 'no');

  // Until the table is confirmed, show the full worst-case estimate (everyone seated, e.g. ~135min);
  // once confirmed it shrinks to the real roster and updates if someone else joins.
  function gameMetaLine(gameId: string, t: Table): string | null {
    const game = gameMap.get(gameId);
    if (!game) return null;
    const seated = t.status === 'confirmed' ? Math.max(t.playerIds.length, game.minPlayers) : game.maxPlayers;
    return `${COMPLEXITY_LABEL[game.complexity]} · ~${estimatedDuration(game, seated)}min`;
  }

  // "✅ N confirmados · 🤔 N interesados" + the popup button, shared by every recommended-table card
  // so the same table reads the same wherever it shows up. Interesados = offered the seat, not accepted yet.
  const rosterSummary = (t: Table) => {
    const interested = (t.candidateIds ?? []).filter((id) => !t.playerIds.includes(id)).length;
    return (
      <>
        <p className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-2">
          <span className="whitespace-nowrap">✅ {t.playerIds.length} confirmados</span>
          <span className="whitespace-nowrap">🤔 {interested} interesados</span>
        </p>
        <button onClick={() => setViewingTableId(t.id)} className="text-xs text-amber-400 hover:underline mt-0.5">
          👀 Ver interesados
        </button>
      </>
    );
  };

  const coverFor = (gameId: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={gameMap.get(gameId)?.imageUrl || '/cover-placeholder.png'} alt=""
      className="w-9 h-11 rounded object-cover border border-gray-700 bg-gray-900 shrink-0" />
  );

  function knowledgeLevelFor(gameId: string): KnowledgeLevel {
    if (canExplain.includes(gameId)) return 'explains';
    if (playedGameIds.includes(gameId)) return 'knows';
    return 'never';
  }

  function setKnowledgeLevel(gameId: string, level: KnowledgeLevel) {
    setCanExplain((cur) => {
      const without = cur.filter((id) => id !== gameId);
      return level === 'explains' ? [...without, gameId] : without;
    });
    setPlayedGameIds((cur) => {
      const without = cur.filter((id) => id !== gameId);
      return level === 'knows' ? [...without, gameId] : without;
    });
  }

  // Voting 👍 for the first time prompts the knowledge-level popup right away — more meaningful in
  // the moment than an always-visible picker on every card, most of which you'll never vote yes on.
  function handleSetInterest(gameId: string, level: InterestLevel | null) {
    const wasYes = interests[gameId] === 'yes';
    setInterests((cur) => {
      const next = { ...cur };
      if (level === null) delete next[gameId]; else next[gameId] = level;
      return next;
    });
    if (level === 'yes' && !wasYes) setKnowledgePromptGameId(gameId);
  }

  async function handleRepeatChoice(gameId: string, wantsRepeat: boolean) {
    setRepeatPromptGameId(null);
    if (!player || !wantsRepeat) return;
    const nextRepeat = [...(player.repeatGameIds ?? []), gameId];
    setPlayer({ ...player, repeatGameIds: nextRepeat });
    await updatePlayerWishlist(code, player.id, {
      interests, canExplain, playedGameIds, repeatGameIds: nextRepeat,
    });
  }

  // Accept/reject for an algorithm-recommended table. On accept, if the player hasn't already
  // opted into a repeat for this game, ask right then whether they'd join a second table of it too.
  async function handleRespondToRecommendation(t: Table, accept: boolean) {
    if (!player || respondingTableId) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    if (accept) {
      setAcceptingTable(t);
      const ok = await resolveScheduleConflict(t); // pops up the overlap warning when there is one
      setAcceptingTable(null);
      if (!ok) return;
    }
    setRespondingTableId(t.id);
    try {
      await respondToRecommendation(code, t.id, player.id, accept, game.minPlayers, game.maxPlayers);
      if (accept) setAcceptedOne(true);
      if (accept && !(player.repeatGameIds ?? []).includes(t.gameId)) setRepeatPromptGameId(t.gameId);
    } finally {
      setRespondingTableId(null);
    }
  }

  // "Rechazar" inside the overlap popup: closes it (cancelling the accept) and declines that table
  async function rejectFromConflictPopup() {
    const t = acceptingTable;
    await handleConflictChoice(false);
    if (t) await handleRespondToRecommendation(t, false);
  }

  const myRecommendedTables = allTables
    .filter((t) => t.status === 'recommended' && !t.postedByOwner && (t.candidateIds ?? []).includes(player.id))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const myAcceptedRecommendedTables = allTables
    .filter((t) => t.status === 'recommended' && !t.postedByOwner && t.playerIds.includes(player.id))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Ones I accepted that already hit the minimum and got confirmed — also shown on the main
  // ticket page, but useful here too to see the whole recommendation flow through.
  const myConfirmedRecommendedTables = allTables
    .filter((t) => !t.postedByOwner && ['confirmed', 'in-progress'].includes(t.status) && t.playerIds.includes(player.id))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // One list with filter chips instead of three columns: a table keeps its place when it changes
  // state (only its badge changes) and overlapping tables sit next to each other, sorted by time.
  type TableKind = 'pending' | 'waiting' | 'confirmed';
  const tableEntries: { t: Table; kind: TableKind }[] = [
    ...myRecommendedTables.map((t) => ({ t, kind: 'pending' as const })),
    ...myAcceptedRecommendedTables.map((t) => ({ t, kind: 'waiting' as const })),
    ...myConfirmedRecommendedTables.map((t) => ({ t, kind: 'confirmed' as const })),
  ].sort((a, b) => a.t.startTime.localeCompare(b.t.startTime));
  // Opens on what needs an answer; falls back to everything when nothing is pending.
  const activeTableFilter: TableFilter = tableFilter ?? (myRecommendedTables.length > 0 ? 'pending' : 'all');
  const visibleEntries = tableEntries.filter((e) => activeTableFilter === 'all' || e.kind === activeTableFilter);

  const TABLE_FILTER_HINT: Record<TableFilter, string> = {
    pending: 'El algoritmo te ofrece un lugar acá según tus votos — aceptá para sumarte o rechazá si ya no te interesa.',
    waiting: 'Ya aceptaste, pero todavía no se llega al mínimo — en cuanto se complete, pasa a confirmada.',
    confirmed: 'Ya llegaron al mínimo — también las vas a ver en la pantalla principal.',
    all: 'Todas tus mesas recomendadas, ordenadas por horario.',
  };
  const TABLE_FILTER_EMPTY: Record<TableFilter, string> = {
    pending: 'No tenés mesas por aceptar. Van a aparecer acá cuando tus votos coincidan con un horario en común.',
    waiting: 'Todavía no aceptaste ninguna mesa recomendada.',
    confirmed: 'Todavía ninguna mesa recomendada se confirmó.',
    all: 'Todavía no hay mesas recomendadas para vos. Votá juegos abajo para que aparezcan.',
  };
  const KIND_BADGE: Record<TableKind, { label: string; cls: string }> = {
    pending: { label: '🟡 Por aceptar', cls: 'bg-amber-900/60 text-amber-300' },
    waiting: { label: '⏳ Esperando jugadores', cls: 'bg-gray-800 text-gray-300' },
    confirmed: { label: '✅ Confirmada', cls: 'bg-green-900/60 text-green-300' },
  };

  const filterChip = (active: boolean, onClick: () => void, label: string, count: number, activeClass: string, highlight = false) => (
    <FilterChip key={label} active={active} onClick={onClick} label={label} count={count} activeClass={activeClass}
      highlightClass={highlight ? 'bg-amber-500 text-black' : undefined} />
  );

  const tableCard = (t: Table, kind: TableKind) => {
    const minPlayers = gameMap.get(t.gameId)?.minPlayers ?? '?';
    const border = kind === 'confirmed' ? 'border-green-800 bg-green-950/10'
      : kind === 'waiting' ? 'border-amber-800 bg-amber-950/10' : 'border-amber-700 bg-amber-950/20';
    return (
      <div key={t.id} className={`border rounded-xl px-3 py-2 ${border}`}>
        <div className="flex justify-between items-start gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {coverFor(t.gameId)}
            <span className="min-w-0">
              <span className={`block font-medium text-sm ${kind === 'confirmed' ? 'text-gray-100' : 'text-amber-300'}`}>{t.gameName}</span>
              <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_BADGE[kind].cls}`}>{KIND_BADGE[kind].label}</span>
            </span>
          </span>
          <span className={`text-xs shrink-0 ${kind === 'confirmed' ? 'text-green-400' : 'text-amber-400'}`}>{t.startTime}–{t.endTime}</span>
        </div>
        {gameMetaLine(t.gameId, t) && (
          <p className="text-[11px] text-gray-500 mt-1">{gameMetaLine(t.gameId, t)}</p>
        )}
        {kind === 'waiting' && <p className="text-xs text-gray-400 mt-1">Mínimo {minPlayers} para confirmar</p>}
        {rosterSummary(t)}
        {kind === 'pending' && (
          <div className="flex gap-2 mt-2">
            <button onClick={() => handleRespondToRecommendation(t, false)} disabled={respondingTableId === t.id}
              className="flex-1 border border-gray-700 rounded-lg py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800 disabled:opacity-50">
              ❌ Rechazar
            </button>
            <button onClick={() => handleRespondToRecommendation(t, true)} disabled={respondingTableId === t.id}
              className="flex-1 bg-amber-600 rounded-lg py-1.5 text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
              {respondingTableId === t.id ? 'Guardando...' : '✅ Aceptar'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const GAME_FILTER_LIST: Record<GameFilter, Game[]> = { available: availableGames, wishlist: wishlistGames, hidden: dismissedGames };
  const GAME_FILTER_EMPTY: Record<GameFilter, string> = {
    available: 'Ya votaste todos los juegos. Los que dijiste que sí están en tu wishlist.',
    wishlist: 'Todavía no elegiste ningún juego. Votá desde “Disponibles”.',
    hidden: 'No ocultaste ningún juego.',
  };
  const visibleGames = GAME_FILTER_LIST[gameFilter];

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">🟡 Mesas recomendadas</h1>
      </div>

      {acceptedOne && <PushOptIn code={code} ticketCode={player.ticketCode} variant="prompt" />}

      <section>
        <div className="flex flex-wrap gap-2 mb-2">
          {filterChip(activeTableFilter === 'pending', () => setTableFilter('pending'), 'Por aceptar', myRecommendedTables.length, 'bg-amber-600 border-amber-600 text-black', true)}
          {filterChip(activeTableFilter === 'waiting', () => setTableFilter('waiting'), '⏳ Esperando', myAcceptedRecommendedTables.length, 'bg-gray-200 border-gray-200 text-gray-900')}
          {filterChip(activeTableFilter === 'confirmed', () => setTableFilter('confirmed'), '✅ Confirmadas', myConfirmedRecommendedTables.length, 'bg-green-600 border-green-600 text-black')}
          {filterChip(activeTableFilter === 'all', () => setTableFilter('all'), 'Todas', tableEntries.length, 'bg-gray-200 border-gray-200 text-gray-900')}
        </div>
        <p className="text-xs text-gray-500 mb-3">{TABLE_FILTER_HINT[activeTableFilter]}</p>
        {visibleEntries.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">{TABLE_FILTER_EMPTY[activeTableFilter]}</p>
        ) : (
          <div className="space-y-2">
            {visibleEntries.map((e) => tableCard(e.t, e.kind))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-200">Votá los juegos <VotingHelp /></h2>
          <Link href={`/event/${code}/votes`}
            className="text-xs border border-gray-700 rounded-lg px-2.5 py-1 hover:bg-gray-800 shrink-0">
            📊 Votos totales
          </Link>
        </div>
        <WhyVoteHelp />
        <div className="flex flex-wrap gap-2 my-3">
          {filterChip(gameFilter === 'available', () => setGameFilter('available'), 'Disponibles', availableGames.length, 'bg-indigo-500 border-indigo-500 text-white')}
          {filterChip(gameFilter === 'wishlist', () => setGameFilter('wishlist'), '❤️ Tu wishlist', wishlistGames.length, 'bg-indigo-500 border-indigo-500 text-white')}
          {filterChip(gameFilter === 'hidden', () => setGameFilter('hidden'), 'Ocultados', dismissedGames.length, 'bg-indigo-500 border-indigo-500 text-white')}
        </div>
        {visibleGames.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">{GAME_FILTER_EMPTY[gameFilter]}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleGames.map((g) => (
              <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={isOwnGroup(g)} ownerLabel={ownerLabel(g)}
                onSetInterest={(level) => handleSetInterest(g.id, level)}
                knowledgeLevel={knowledgeLevelFor(g.id)} onEditKnowledge={() => setKnowledgePromptGameId(g.id)} />
            ))}
          </div>
        )}

        <SaveStatusPill status={saveStatus} onRetry={retrySave} />
      </section>

      {knowledgePromptGameId && (() => {
        const game = gameMap.get(knowledgePromptGameId);
        if (!game) return null;
        const close = () => setKnowledgePromptGameId(null);
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
            <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
              onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-100">¿Qué tan bien conocés {game.name}?</h3>
              <KnowledgeLevelPicker value={knowledgeLevelFor(game.id)}
                onChange={(level) => { setKnowledgeLevel(game.id, level); close(); }} />
              <button onClick={close} className="w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800">
                Ahora no
              </button>
            </div>
          </div>
        );
      })()}

      {viewingTableId && (() => {
        const t = allTables.find((x) => x.id === viewingTableId);
        if (!t) return null;
        const close = () => setViewingTableId(null);
        const candidates = (t.candidateIds ?? []).filter((id) => !t.playerIds.includes(id));
        const nameList = (ids: string[]) => ids.map((id) => (id === myId ? 'Vos' : otherPlayerMap.get(id)?.name ?? '?'));
        const group = (title: string, ids: string[], empty: string) => (
          <div>
            <p className="text-xs font-semibold text-gray-300 mb-1">{title} ({ids.length})</p>
            {ids.length === 0 ? (
              <p className="text-xs text-gray-500">{empty}</p>
            ) : (
              <ul className="text-xs text-gray-400 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {nameList(ids).map((n, i) => <li key={i} className="truncate">{n}</li>)}
              </ul>
            )}
          </div>
        );
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
            <div className="max-w-sm w-full max-h-[80vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
              onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className="font-semibold text-gray-100">{t.gameName}</h3>
                <p className="text-xs text-gray-500">{t.startTime}–{t.endTime}</p>
              </div>
              {t.explainerId && (
                <p className="text-xs text-gray-400">🎓 Explica: <span className="text-gray-300">{nameList([t.explainerId])[0]}</span></p>
              )}
              {group('✅ Confirmados', t.playerIds, 'Nadie todavía.')}
              {group('🤔 Interesados (sin confirmar)', candidates, 'No quedan interesados pendientes.')}
              <button onClick={close} className="w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800">
                Cerrar
              </button>
            </div>
          </div>
        );
      })()}

      {repeatPromptGameId && (() => {
        const game = gameMap.get(repeatPromptGameId);
        if (!game) return null;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50"
            onClick={() => handleRepeatChoice(game.id, false)}>
            <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
              onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-100">
                ¿Te gustaría sumarte también a una segunda mesa de {game.name} si se llega a armar otra?
              </h3>
              <div className="flex gap-2">
                <button onClick={() => handleRepeatChoice(game.id, false)}
                  className="flex-1 border border-gray-700 rounded-lg py-2 text-xs font-medium text-gray-400 hover:bg-gray-800">
                  No, con esta alcanza
                </button>
                <button onClick={() => handleRepeatChoice(game.id, true)}
                  className="flex-1 bg-indigo-600 rounded-lg py-2 text-xs font-medium hover:bg-indigo-700">
                  Sí, sumame también
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} onReject={rejectFromConflictPopup} />
    </main>
  );
}
