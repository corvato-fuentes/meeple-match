'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames,
  updatePlayerWishlist, subscribeTables, getPlayerTables,
} from '@/lib/firestore';
import { BOARD_RETURN_KEY } from '@/lib/boardReturn';
import { bggSearchUrl } from '@/lib/bgg';
import type { MeepleEvent, Player, Game, Table, GameComplexity } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

type InterestLevel = 'must' | 'casual' | 'no';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  light: 'Ligero',
  medium: 'Medio',
  heavy: 'Complejo',
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
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? sessionStorage.getItem(STORAGE_KEY(code))) as string | null;
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
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    if (!player) return;
    const unsub = subscribeTables(code, (ts) => setMyTables(getPlayerTables(player.id, ts)));
    return unsub;
  }, [code, player]);

  async function saveWishlist() {
    if (!player) return;
    setSaving(true);
    await updatePlayerWishlist(code, player.id, { interests, canExplain });
    setSaving(false);
  }

  function toggleCanExplain(gameId: string) {
    setCanExplain((cur) => cur.includes(gameId) ? cur.filter((id) => id !== gameId) : [...cur, gameId]);
  }

  function copyCode() {
    if (!player) return;
    navigator.clipboard.writeText(player.ticketCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const otherGames = games.filter((g) => g.ownerPlayerId !== player.id);
  const wishlistGames = otherGames.filter((g) => interests[g.id] === 'must' || interests[g.id] === 'casual');
  // Unvoted games stay on top; "no"-voted games are collapsed into a separate section below.
  const availableGames = otherGames
    .filter((g) => interests[g.id] !== 'must' && interests[g.id] !== 'casual' && interests[g.id] !== 'no');
  const dismissedGames = otherGames.filter((g) => interests[g.id] === 'no');
  const confirmedTables = myTables.filter((t) =>
    ['confirmed', 'in-progress', 'proposed'].includes(t.status)
  );

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
        </div>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">Tus mesas</h2>
          {confirmedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía no tenés mesas asignadas. Las verás aparecer acá en tiempo real.
            </p>
          ) : (
            <div className="space-y-2">
              {confirmedTables.map((t) => (
                <div key={t.id} className="border border-gray-700 rounded-xl px-4 py-3 bg-gray-800">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{t.gameName}</span>
                    <span className={'text-xs px-2 py-0.5 rounded-full ' + (statusBadge[t.status] ?? 'bg-gray-700 text-gray-300')}>
                      {t.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">Mesa {t.tableNumber} · {t.startTime}–{t.endTime}</p>
                </div>
              ))}
            </div>
          )}
          <Link href={`/event/${code}/board`}
            onClick={() => sessionStorage.setItem(BOARD_RETURN_KEY(code), `/event/${code}/me?ticket=${player.ticketCode}`)}
            className="block text-center mt-3 text-sm border border-gray-700 rounded-xl py-2 hover:bg-gray-800">
            📺 Ver grilla completa
          </Link>
        </section>
      </div>

      <section>
        <h2 className="font-semibold text-gray-200 mb-3">Votá los juegos</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Juegos disponibles</h3>
            <div className="space-y-2">
              {availableGames.map((g) => (
                <GameVoteCard key={g.id} game={g} interest={interests[g.id]}
                  onSetInterest={(level) => setInterests({ ...interests, [g.id]: level })}
                  canExplain={canExplain.includes(g.id)} onToggleCanExplain={() => toggleCanExplain(g.id)} />
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
                      <GameVoteCard key={g.id} game={g} interest={interests[g.id]}
                        onSetInterest={(level) => setInterests({ ...interests, [g.id]: level })}
                        canExplain={canExplain.includes(g.id)} onToggleCanExplain={() => toggleCanExplain(g.id)} />
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
                  <GameVoteCard key={g.id} game={g} interest={interests[g.id]}
                    onSetInterest={(level) => setInterests({ ...interests, [g.id]: level })}
                    canExplain={canExplain.includes(g.id)} onToggleCanExplain={() => toggleCanExplain(g.id)} />
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
  game, interest, onSetInterest, canExplain, onToggleCanExplain,
}: {
  game: Game;
  interest: InterestLevel | undefined;
  onSetInterest: (level: InterestLevel) => void;
  canExplain: boolean;
  onToggleCanExplain: () => void;
}) {
  return (
    <div className="border border-gray-700 rounded-xl px-3 py-2 bg-gray-800">
      <div className="flex justify-between items-start mb-1">
        <span className="font-medium text-sm">{game.name}</span>
        <span className="text-xs text-gray-500">{game.minPlayers}–{game.maxPlayers}p · {COMPLEXITY_LABEL[game.complexity]}</span>
      </div>
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
    </div>
  );
}
