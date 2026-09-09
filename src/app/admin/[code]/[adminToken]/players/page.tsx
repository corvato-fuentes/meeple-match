'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribePlayers, getGames, subscribeTables, getPlayerTables, deletePlayer } from '@/lib/firestore';
import type { MeepleEvent, Player, Game, Table } from '@/lib/types';

export default function PlayersPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [viewingProof, setViewingProof] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedVotesId, setExpandedVotesId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendingAll, setResendingAll] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);

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

  async function handleDeletePlayer(player: Player) {
    if (!confirm(`¿Eliminar a ${player.name}? Se borrarán sus juegos y su lugar en las mesas.`)) return;
    setDeletingId(player.id);
    try {
      await deletePlayer(code, player.id);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleResend(player: Player) {
    setResendingId(player.id);
    setResendMsg(null);
    try {
      const res = await fetch('/api/email/resend-ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, adminToken, playerId: player.id }),
      });
      const data = await res.json();
      setResendMsg(data.sent ? `✓ Reenviado a ${player.name}` : `${player.name} no tiene email cargado`);
    } catch {
      setResendMsg(`No se pudo reenviar a ${player.name}`);
    } finally {
      setResendingId(null);
    }
  }

  async function handleResendAll() {
    if (!confirm('¿Reenviar el mail con el código a todos los jugadores que tengan email cargado?')) return;
    setResendingAll(true);
    setResendMsg(null);
    try {
      const res = await fetch('/api/email/resend-all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, adminToken }),
      });
      const data = await res.json();
      setResendMsg(`✓ Se mandaron ${data.sent} de ${data.total} mails`);
    } catch {
      setResendMsg('No se pudo reenviar a todos');
    } finally {
      setResendingAll(false);
    }
  }

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const gameMap = new Map(games.map((g) => [g.id, g]));

  const VOTE_LABEL: Record<string, string> = { must: '❤️ Quiero', casual: '👍 Me sumo', no: '👎 No' };

  return (
    <main className='max-w-2xl mx-auto px-4 py-10'>
      <div className='flex items-center gap-3 mb-2'>
        <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
        <h1 className='text-xl font-bold'>Jugadores — {event.name}</h1>
        <span className='text-sm text-gray-500'>{players.length}{event.settings.maxPlayers ? ` / ${event.settings.maxPlayers}` : ''}</span>
      </div>
      <div className='flex items-center gap-3 mb-6'>
        <button onClick={handleResendAll} disabled={resendingAll}
          className='text-xs border border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-800 disabled:opacity-50'>
          {resendingAll ? 'Enviando...' : '✉️ Reenviar código a todos'}
        </button>
        {resendMsg && <span className='text-xs text-gray-400'>{resendMsg}</span>}
      </div>

      {players.length === 0 ? (
        <p className='text-gray-500 text-center py-12'>Esperando inscriptos...</p>
      ) : (
        <div className='space-y-3'>
          {players.map((p) => {
            const myTables = getPlayerTables(p.id, tables);
            const votedCount = Object.values(p.interests).filter((v) => v === 'must' || v === 'casual' || v === 'no').length;
            const likedCount = Object.values(p.interests).filter((v) => v === 'must' || v === 'casual').length;
            return (
              <div key={p.id} className='border border-gray-700 rounded-xl p-4 bg-gray-800'>
                <div className='flex justify-between items-start'>
                  <div>
                    <p className='font-semibold'>{p.name}</p>
                    {p.alias && <p className='text-xs text-gray-500'>{p.firstName} {p.lastName}</p>}
                    <p className='text-sm text-gray-400'>{p.arrivalTime}–{p.departureTime} · ticket: <span className='font-mono'>{p.ticketCode}</span></p>
                    <p className='text-xs text-gray-500'>
                      {p.email ?? 'sin email'} · {p.phone ?? 'sin teléfono'}
                      {p.registeredAt?.toDate && ` · inscrito ${p.registeredAt.toDate().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`}
                    </p>
                    <p className={'text-xs mt-0.5 ' + (votedCount === 0 ? 'text-amber-400' : 'text-gray-500')}>
                      {votedCount === 0 ? '⚠️ No votó ningún juego' : `Votó ${votedCount} juego${votedCount !== 1 ? 's' : ''} · le gustaron ${likedCount}`}
                    </p>
                  </div>
                  <span className='text-xs text-gray-500'>{myTables.length} mesa{myTables.length !== 1 ? 's' : ''}</span>
                </div>
                <div className='flex items-center gap-3 mt-2'>
                  {p.paymentProofUrl && (
                    <button onClick={() => setViewingProof(p.paymentProofUrl)}
                      className='inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline'>
                      🧾 Ver comprobante
                    </button>
                  )}
                  {p.email && (
                    <button onClick={() => handleResend(p)} disabled={resendingId === p.id}
                      className='inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline disabled:opacity-50'>
                      {resendingId === p.id ? 'Enviando...' : '✉️ Reenviar código'}
                    </button>
                  )}
                  <button onClick={() => handleDeletePlayer(p)} disabled={deletingId === p.id}
                    className='inline-flex items-center gap-1 text-xs text-red-400 hover:underline disabled:opacity-50'>
                    {deletingId === p.id ? 'Eliminando...' : '🗑️ Eliminar jugador'}
                  </button>
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
                {votedCount > 0 && (
                  <div className='mt-2'>
                    <button onClick={() => setExpandedVotesId((cur) => cur === p.id ? null : p.id)}
                      className='text-xs text-gray-500 hover:text-gray-300'>
                      {expandedVotesId === p.id ? '▾' : '▸'} Ver votos ({votedCount})
                    </button>
                    {expandedVotesId === p.id && (
                      <div className='mt-1.5 space-y-1'>
                        {Object.entries(p.interests).map(([gid, level]) => (
                          <div key={gid} className='flex items-center justify-between text-xs text-gray-300 bg-gray-900 rounded-lg px-2 py-1'>
                            <span>{gameMap.get(gid)?.name ?? gid} <span className='text-gray-500'>({gameMap.get(gid)?.ownerName ?? '?'})</span></span>
                            <span className='flex items-center gap-1.5 shrink-0'>
                              {VOTE_LABEL[level] ?? level}
                              {p.canExplain.includes(gid) && <span className='text-purple-300'>explica</span>}
                              {(p.repeatGameIds ?? []).includes(gid) && <span className='text-indigo-300'>🔁</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {viewingProof && (
        <div className='fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50' onClick={() => setViewingProof(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={viewingProof} alt='Comprobante de pago' className='max-h-full max-w-full rounded-lg' />
          <button onClick={() => setViewingProof(null)}
            className='absolute top-4 right-4 text-white text-2xl leading-none'>
            ✕
          </button>
        </div>
      )}
    </main>
  );
}
