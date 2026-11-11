'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getEvent, getPlayerByTicketCode, getGames } from '@/lib/firestore';
import { useAutoSaveWishlist } from '@/hooks/useAutoSaveWishlist';
import { useOpenGameRequests } from '@/hooks/useOpenGameRequests';
import SaveStatusPill from '@/components/ui/SaveStatus';
import FilterChip from '@/components/ui/FilterChip';
import GameFilterBar from '@/components/ui/GameFilterBar';
import { filterGames, hasAnyFilter, NO_FILTERS, type GameFilters } from '@/lib/gameFilters';
import GameVoteCard from '@/components/ui/GameVoteCard';
import VotingHelp from '@/components/ui/VotingHelp';
import WhyVoteHelp from '@/components/ui/WhyVoteHelp';
import KnowledgeLevelPicker, { type KnowledgeLevel } from '@/components/ui/KnowledgeLevelPicker';
import type { MeepleEvent, Player, Game, InterestLevel } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

type GameFilter = 'available' | 'wishlist' | 'hidden';

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
  const [gameFilter, setGameFilter] = useState<GameFilter>('available');
  // Search + difficulty / duration / players, applied on top of the chip (Disponibles / Wishlist / Ocultados)
  const [filters, setFilters] = useState<GameFilters>(NO_FILTERS);
  const [knowledgePromptGameId, setKnowledgePromptGameId] = useState<string | null>(null);

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

  // Votes and knowledge levels save themselves a moment after the last change.
  const { status: saveStatus, retry: retrySave } = useAutoSaveWishlist(code, player?.id, event,
    player ? { interests, canExplain, playedGameIds, repeatGameIds: player.repeatGameIds ?? [] } : null);
  const openGameRequests = useOpenGameRequests(code, player?.ticketCode, games);

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

  // Chips instead of side-by-side columns; always opens on "Disponibles", the list left to vote on.
  const GAME_FILTER_LIST: Record<GameFilter, Game[]> = { available: availableGames, wishlist: wishlistGames, hidden: dismissedGames };
  const GAME_FILTER_EMPTY: Record<GameFilter, string> = {
    available: 'Ya votaste todos los juegos. Los que dijiste que sí están en tu wishlist.',
    wishlist: 'Todavía no elegiste ningún juego. Votá desde “Disponibles”.',
    hidden: 'No ocultaste ningún juego.',
  };
  const chipGames = GAME_FILTER_LIST[gameFilter];
  const visibleGames = filterGames(chipGames, filters);

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
  // "Would play a second table of it" — on or off; saved with the votes
  function setRepeat(gameId: string, on: boolean) {
    setPlayer((p) => p && ({
      ...p, repeatGameIds: on ? [...new Set([...(p.repeatGameIds ?? []), gameId])] : (p.repeatGameIds ?? []).filter((id) => id !== gameId),
    }));
  }

  function handleSetInterest(gameId: string, level: InterestLevel | null) {
    const wasYes = interests[gameId] === 'yes';
    if (wasYes && level !== 'yes') setRepeat(gameId, false); // no longer interested: there is no second table to want
    setInterests((cur) => {
      const next = { ...cur };
      if (level === null) delete next[gameId]; else next[gameId] = level;
      return next;
    });
    if (level === 'yes' && !wasYes) setKnowledgePromptGameId(gameId);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">🎲 Juegos de todos</h1>      </div>

      {/* Not seeing a game you would like to play? Ask for it: whoever has it can bring it */}
      <Link href={`/event/${code}/requests?ticket=${player.ticketCode}`}
        className="flex items-center justify-between gap-3 border border-purple-800 text-purple-200 rounded-xl px-3 py-2.5 text-sm hover:bg-purple-950/30">
        <span>
          🙏 Juegos pedidos
          {openGameRequests != null && openGameRequests > 0 && (
            <span className="ml-2 text-xs bg-purple-400 text-black font-bold rounded-full px-1.5 py-0.5">{openGameRequests} se buscan</span>
          )}
        </span>
        <span aria-hidden="true">→</span>
      </Link>

      <section>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-200">Votá los juegos <span className="text-sm font-normal text-gray-500">({primaryGames.length})</span> <VotingHelp /></h2>
          <Link href={`/event/${code}/votes`}
            className="text-xs border border-gray-700 rounded-lg px-2.5 py-1 hover:bg-gray-800 shrink-0">
            📊 Votos totales
          </Link>
        </div>
        <WhyVoteHelp />
        <div className="flex flex-wrap gap-2 my-3">
          <FilterChip active={gameFilter === 'available'} onClick={() => setGameFilter('available')} label="Disponibles"
            count={availableGames.length} activeClass="bg-indigo-500 border-indigo-500 text-white" />
          <FilterChip active={gameFilter === 'wishlist'} onClick={() => setGameFilter('wishlist')} label="❤️ Tu wishlist"
            count={wishlistGames.length} activeClass="bg-indigo-500 border-indigo-500 text-white" />
          <FilterChip active={gameFilter === 'hidden'} onClick={() => setGameFilter('hidden')} label="Ocultados"
            count={dismissedGames.length} activeClass="bg-indigo-500 border-indigo-500 text-white" />
        </div>
        {chipGames.length > 0 && <GameFilterBar filters={filters} onChange={setFilters} shown={visibleGames.length} total={chipGames.length} />}
        {visibleGames.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
            {chipGames.length > 0 && hasAnyFilter(filters) ? 'Ningún juego coincide con la búsqueda y los filtros.' : GAME_FILTER_EMPTY[gameFilter]}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleGames.map((g) => (
              <GameVoteCard key={g.id} game={g} interest={interests[g.id]} isOwn={isOwnGroup(g)} ownerLabel={ownerLabel(g)}
                onSetInterest={(level) => handleSetInterest(g.id, level)}
                repeat={(player.repeatGameIds ?? []).includes(g.id)}
                onToggleRepeat={() => setRepeat(g.id, !(player.repeatGameIds ?? []).includes(g.id))}
                knowledgeLevel={knowledgeLevelFor(g.id)} onEditKnowledge={() => setKnowledgePromptGameId(g.id)} />
            ))}
          </div>
        )}

        <SaveStatusPill status={saveStatus} onRetry={retrySave} />
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
