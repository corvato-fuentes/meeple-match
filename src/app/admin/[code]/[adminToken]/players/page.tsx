'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribePlayers, getGames, subscribeTables, getPlayerTables } from '@/lib/firestore';
import type { MeepleEvent, Player, Game, Table } from '@/lib/types';

export default function PlayersPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      setAuthorized(ok);
      if (ok) setEvent(await getEvent(code));
    });
    getGames(code).then(setGames);
    const unsubP = subscribePlayers(code, setPlayers);
    const unsubT = subscribeTables(code, setTables);
    return () => { unsubP(); unsubT(); };
  }, [code, adminToken]);

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const gameMap = new Map(games.map((g) => [g.id, g]));

  return (
    <main className='max-w-2xl mx-auto px-4 py-10'>
      <div className='flex items-center gap-3 mb-6'>
        <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
        <h1 className='text-xl font-bold'>Jugadores — {event.name}</h1>
        <span className='text-sm text-gray-500'>{players.length}{event.settings.maxPlayers ? ` / ${event.settings.maxPlayers}` : ''}</span>
      </div>

      {players.length === 0 ? (
        <p className='text-gray-500 text-center py-12'>Esperando inscriptos...</p>
      ) : (
        <div className='space-y-3'>
          {players.map((p) => {
            const myTables = getPlayerTables(p.id, tables);
            return (
              <div key={p.id} className='border border-gray-700 rounded-xl p-4 bg-gray-800'>
                <div className='flex justify-between items-start'>
                  <div>
                    <p className='font-semibold'>{p.name}</p>
                    <p className='text-sm text-gray-400'>{p.arrivalTime}–{p.departureTime} · ticket: <span className='font-mono'>{p.ticketCode}</span></p>
                  </div>
                  <span className='text-xs text-gray-500'>{myTables.length} mesa{myTables.length !== 1 ? 's' : ''}</span>
                </div>
                {p.bringGameIds.length > 0 && (
                  <div className='mt-2 flex flex-wrap gap-1'>
                    {p.bringGameIds.map((gid) => (
                      <span key={gid} className='text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full'>
                        {gameMap.get(gid)?.name ?? gid}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
