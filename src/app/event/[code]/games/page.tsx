'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getEvent, getPlayerByTicketCode, getGames, updatePlayerWishlist } from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import GameVoteCard from '@/components/ui/GameVoteCard';
import VotingHelp from '@/components/ui/VotingHelp';
import WhyVoteHelp from '@/components/ui/WhyVoteHelp';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Player, Game, InterestLevel } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

// Pure "browse and vote" view — every game in the event, with no tables/schedule shown at all.
// The same voting UI also lives on the Mesas recomendadas page (since votes drive it directly),
// but this one is the quick, dedicated spot to just go vote without any table-management context.
export default function GamesVotePage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
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
      const [ev, gs] = await Promise.all([getEvent(code), getGames(code)]);
      const p = await getPlayerByTicketCode(code, ticketCode!);
      if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); router.replace('/event/' + code); return; }
      setEvent(ev);
      setPlayer(p);
      setGames(gs);
      setInterests(p.interests as Record<string, InterestLevel>);
      setCanExplain(p.canExplain);
      setPlayedGameIds(p.playedGameIds ?? []);
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

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

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">🎲 Juegos de todos</h1>
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
        const game = games.find((g) => g.id === knowledgePromptGameId);
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
    </main>
  );
}
