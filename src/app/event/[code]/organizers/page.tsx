'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, getPlayerByTicketCode, getPlayers } from '@/lib/firestore';
import type { MeepleEvent, Player } from '@/lib/types';

// Unlike the public roster, this shows organizers' phone numbers — so it requires a valid ticket
// (same as /me) instead of being reachable by anyone who knows the event code.
export default function OrganizersPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [organizers, setOrganizers] = useState<Player[] | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      const ticket = searchParams.get('ticket');
      const [ev, me] = await Promise.all([
        getEvent(code),
        ticket ? getPlayerByTicketCode(code, ticket) : Promise.resolve(null),
      ]);
      setEvent(ev);
      if (!ev || !me) { setAuthorized(false); return; }
      setAuthorized(true);
      const players = await getPlayers(code);
      setOrganizers(players.filter((p) => p.isOrganizer).sort((a, b) => a.name.localeCompare(b.name)));
    }
    load();
  }, [code, searchParams]);

  if (authorized === false) return <div className="p-8 text-center text-red-500">Acceso denegado — abrí este link desde tu ticket.</div>;
  if (!event || authorized !== true || !organizers) return <div className="p-8 text-center">Cargando...</div>;

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/event/${code}/me?ticket=${searchParams.get('ticket')}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">Organizadores — {event.name}</h1>
        <span className="text-sm text-gray-500">{organizers.length}</span>
      </div>

      {organizers.length === 0 ? (
        <p className="text-gray-500 text-center py-12">Todavía no hay organizadores marcados para este evento.</p>
      ) : (
        <div className="space-y-2">
          {organizers.map((p) => (
            <div key={p.id} className="border border-gray-700 rounded-xl p-3 bg-gray-800">
              <p className="font-semibold">{p.firstName} {p.lastName}{p.alias && <span className="text-gray-400 font-normal"> · {p.alias}</span>}</p>
              <p className="text-sm text-gray-400">{p.phone ?? 'sin teléfono cargado'}</p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
