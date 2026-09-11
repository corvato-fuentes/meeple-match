'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, getGames, getPlayers } from '@/lib/firestore';
import type { MeepleEvent, Game, Player } from '@/lib/types';

/** Public, read-only view of every game and its vote totals — anyone with the event link can see it. */
export default function VotesPage() {
  const { code } = useParams<{ code: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getEvent(code), getGames(code), getPlayers(code)]).then(([ev, gs, ps]) => {
      setEvent(ev);
      setGames(gs);
      setPlayers(ps);
      setLoading(false);
    });
  }, [code]);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!event) return <div className="p-8 text-center">Evento no encontrado.</div>;

  // Merged duplicates only get one row — the primary — combining every copy's owner name.
  const primaryGames = games.filter((g) => !g.groupId || g.groupId === g.id);
  const ownerLabel = (g: Game) => games.filter((m) => (m.groupId ?? m.id) === g.id).map((m) => m.ownerName).join(', ');

  const rows = primaryGames.map((g) => {
    const must = players.filter((p) => p.interests[g.id] === 'must').length;
    const casual = players.filter((p) => p.interests[g.id] === 'casual').length;
    const no = players.filter((p) => p.interests[g.id] === 'no').length;
    const explainers = players.filter((p) => p.canExplain.includes(g.id)).length;
    return { game: g, must, casual, no, explainers, total: must + casual };
  }).sort((a, b) => b.must - a.must || b.casual - a.casual);

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/event/${code}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">Votos totales — {event.name}</h1>
        <span className="text-sm text-gray-500">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-500 text-center py-12">Todavía no hay juegos cargados.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(({ game, must, casual, no, explainers, total }) => {
            const notEnough = total < game.minPlayers;
            const label = ownerLabel(game);
            const copyCount = label.split(',').length;
            return (
              <div key={game.id} className={'border rounded-xl p-3 bg-gray-800 ' + (notEnough ? 'border-amber-800' : 'border-gray-700')}>
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">
                      {game.name}
                      {copyCount > 1 && <span className="ml-2 text-xs bg-indigo-900 text-indigo-300 px-1.5 rounded">🧩 {copyCount} copias</span>}
                    </p>
                    <p className="text-xs text-gray-500">Trae: {label} · {game.minPlayers}–{game.maxPlayers}p · {game.durationMinutes}min</p>
                  </div>
                  {notEnough && <span className="text-xs text-amber-400 shrink-0">⚠️ Faltan votos ({total}/{game.minPlayers})</span>}
                </div>
                <div className="flex gap-3 mt-2 text-sm">
                  <span className="text-red-300">❤️ {must}</span>
                  <span className="text-blue-300">👍 {casual}</span>
                  <span className="text-gray-500">👎 {no}</span>
                  <span className="text-purple-300">🎓 {explainers} explica{explainers !== 1 ? 'n' : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
