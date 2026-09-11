'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, getGames, getPlayers } from '@/lib/firestore';
import type { MeepleEvent, Game, Player } from '@/lib/types';

/** Public, read-only roster of everyone registered — no email/phone/payment info shown here. */
export default function RosterPage() {
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

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/event/${code}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">Inscriptos — {event.name}</h1>
        <span className="text-sm text-gray-500">{players.length}</span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-gray-500 text-center py-12">Todavía no hay inscriptos.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => (
            <div key={p.id} className="border border-gray-700 rounded-xl p-3 bg-gray-800">
              <div className="flex justify-between items-start">
                <p className="font-semibold">{p.name}</p>
                <span className="text-xs text-gray-500 shrink-0">{p.arrivalTime}–{p.departureTime}</span>
              </div>
              {p.bringGameIds.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.bringGameIds.map((gid) => (
                    <span key={gid} className="text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full">
                      {gameMap.get(gid)?.name ?? gid}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
