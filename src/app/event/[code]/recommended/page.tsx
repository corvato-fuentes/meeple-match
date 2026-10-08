'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables,
  respondToRecommendation, updatePlayerWishlist,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { estimatedDurationRange } from '@/lib/tableAlgorithm';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import GameVoteCard from '@/components/ui/GameVoteCard';
import VotingHelp from '@/components/ui/VotingHelp';
import WhyVoteHelp from '@/components/ui/WhyVoteHelp';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Player, Game, Table, GameComplexity, InterestLevel } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

const COMPLEXITY_LABEL: Record<GameComplexity, string> = { light: 'Liviano', medium: 'Intermedio', heavy: 'Pesado' };

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
  const [interests, setInterests] = useState<Record<string, InterestLevel>>({});
  const [canExplain, setCanExplain] = useState<string[]>([]);
  const [playedGameIds, setPlayedGameIds] = useState<string[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [knowledgePromptGameId, setKnowledgePromptGameId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  function gameMetaLine(gameId: string): string | null {
    const game = gameMap.get(gameId);
    if (!game) return null;
    const [min, max] = estimatedDurationRange(game);
    return `${COMPLEXITY_LABEL[game.complexity]} · ~${min === max ? `${min}` : `${min}–${max}`}min`;
  }

  function namesFor(ids: string[]): string {
    return ids.map((id) => (id === myId ? 'vos' : otherPlayerMap.get(id)?.name ?? '?')).join(', ');
  }

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

  async function saveWishlist() {
    if (!player || !event) return;
    setSaving(true);
    await updatePlayerWishlist(code, player.id, {
      interests, canExplain, playedGameIds, repeatGameIds: player.repeatGameIds ?? [],
    });
    // Fire-and-forget: don't make the player wait on the scheduling algorithm.
    runTableGeneration(code, event).catch(() => {});
    setSaving(false);
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
    if (accept && !(await resolveScheduleConflict(t))) return;
    setRespondingTableId(t.id);
    try {
      await respondToRecommendation(code, t.id, player.id, accept, game.minPlayers, game.maxPlayers);
      if (accept && !(player.repeatGameIds ?? []).includes(t.gameId)) setRepeatPromptGameId(t.gameId);
    } finally {
      setRespondingTableId(null);
    }
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

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">🟡 Mesas recomendadas</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <section>
          <h2 className="font-semibold text-gray-200 mb-2">Por aceptar</h2>
          <p className="text-xs text-gray-500 mb-2">
            El algoritmo te ofrece un lugar acá según tus votos — aceptá para sumarte o rechazá si ya no te interesa.
          </p>
          {myRecommendedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía no sos candidato de ninguna mesa armada por el algoritmo. Van a aparecer acá cuando tus votos coincidan con un horario en común.
            </p>
          ) : (
            <div className="space-y-2">
              {myRecommendedTables.map((t) => {
                // Everyone the algorithm offered this seat to who hasn't accepted yet (me included).
                const stillDeciding = (t.candidateIds ?? []).filter((id) => !t.playerIds.includes(id));
                return (
                <div key={t.id} className="border border-amber-700 rounded-xl px-3 py-2 bg-amber-950/20">
                  <div className="flex justify-between items-start">
                    <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm text-amber-300">{t.gameName}</span></span>
                    <span className="text-xs text-amber-400 shrink-0">{t.startTime}–{t.endTime}</span>
                  </div>
                  {gameMetaLine(t.gameId) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId)}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1 whitespace-nowrap">
                    ✅ {t.playerIds.length} aceptaron · 👥 {stillDeciding.length} candidatos
                  </p>
                  <button onClick={() => setViewingTableId(t.id)} className="text-xs text-amber-400 hover:underline mt-0.5">
                    👀 Ver inscriptos
                  </button>
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
                </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">⏳ Esperando jugadores</h2>
          <p className="text-xs text-gray-500 mb-2">
            Ya aceptaste, pero todavía no se llega al mínimo — en cuanto se complete, pasa a confirmada.
          </p>
          {myAcceptedRecommendedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía no aceptaste ninguna mesa recomendada.
            </p>
          ) : (
            <div className="space-y-2">
              {myAcceptedRecommendedTables.map((t) => {
                const minPlayers = gameMap.get(t.gameId)?.minPlayers ?? '?';
                return (
                  <div key={t.id} className="border border-amber-800 rounded-xl px-3 py-2 bg-amber-950/10">
                    <div className="flex justify-between items-start">
                      <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm text-amber-300">{t.gameName}</span></span>
                      <span className="text-xs text-amber-400 shrink-0">{t.startTime}–{t.endTime}</span>
                    </div>
                    {gameMetaLine(t.gameId) && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId)}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">✅ {t.playerIds.length}/{minPlayers} · esperando que se sumen más candidatos</p>
                    <p className="text-xs text-gray-400">👥 {namesFor(t.playerIds)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">✅ Confirmadas</h2>
          <p className="text-xs text-gray-500 mb-2">Ya llegaron al mínimo — también las vas a ver en la pantalla principal.</p>
          {myConfirmedRecommendedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía ninguna mesa recomendada se confirmó.
            </p>
          ) : (
            <div className="space-y-2">
              {myConfirmedRecommendedTables.map((t) => (
                <div key={t.id} className="border border-green-800 bg-green-950/10 rounded-xl px-3 py-2">
                  <div className="flex justify-between items-start">
                    <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm">{t.gameName}</span></span>
                    <span className="text-xs text-green-400 shrink-0">{t.startTime}–{t.endTime}</span>
                  </div>
                  {gameMetaLine(t.gameId) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId)}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">✅ {namesFor(t.playerIds)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-200">Votá los juegos <VotingHelp /></h2>
          <Link href={`/event/${code}/votes`}
            className="text-xs border border-gray-700 rounded-lg px-2.5 py-1 hover:bg-gray-800 shrink-0">
            📊 Votos totales
          </Link>
        </div>
        <WhyVoteHelp />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Juegos disponibles</h3>
            <div className="space-y-2">
              {availableGames.map((g) => (
                <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={isOwnGroup(g)} ownerLabel={ownerLabel(g)}
                  onSetInterest={(level) => handleSetInterest(g.id, level)}
                  knowledgeLevel={knowledgeLevelFor(g.id)} onEditKnowledge={() => setKnowledgePromptGameId(g.id)} />
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
                        onSetInterest={(level) => handleSetInterest(g.id, level)}
                        knowledgeLevel={knowledgeLevelFor(g.id)} onEditKnowledge={() => setKnowledgePromptGameId(g.id)} />
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
                    onSetInterest={(level) => handleSetInterest(g.id, level)}
                    knowledgeLevel={knowledgeLevelFor(g.id)} onEditKnowledge={() => setKnowledgePromptGameId(g.id)} />
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
              {group('✅ Ya aceptaron', t.playerIds, 'Nadie todavía.')}
              {group('👥 Candidatos', candidates, 'No quedan candidatos pendientes.')}
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

      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
    </main>
  );
}
