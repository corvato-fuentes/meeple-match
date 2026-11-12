'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribePlayers, getGames, subscribeTables, deletePlayer, updatePlayerTimes, setPlayerOrganizer, setPlayerRegistrationStatus } from '@/lib/firestore';
import { tentativeCount, confirmedPlayers, receiptStateOf, owesReceipt } from '@/lib/registration';
import { reviewReceipt, remindReceipts } from '@/lib/paymentReviewClient';
import { countByState, playerTableEntries } from '@/lib/playerTables';
import { runTableGeneration } from '@/lib/tableGeneration';
import AdminPlayerCard from '@/components/admin/AdminPlayerCard';
import type { MeepleEvent, Player, Game, Table } from '@/lib/types';

export default function PlayersPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [viewingProof, setViewingProof] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null); // a receipt decision or a reminder in flight
  const [remindMsg, setRemindMsg] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendingAll, setResendingAll] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [editingTimesId, setEditingTimesId] = useState<string | null>(null);
  const [draftArrival, setDraftArrival] = useState('');
  const [draftDeparture, setDraftDeparture] = useState('');
  const [savingTimes, setSavingTimes] = useState(false);

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

  function startEditTimes(p: Player) {
    setEditingTimesId(p.id);
    setDraftArrival(p.arrivalTime);
    setDraftDeparture(p.departureTime);
  }

  async function saveTimes(playerId: string) {
    if (savingTimes) return;
    setSavingTimes(true);
    try {
      await updatePlayerTimes(code, playerId, draftArrival, draftDeparture);
      setEditingTimesId(null);
      // Fire-and-forget: availability changed, so tables may need to be reshuffled.
      if (event) runTableGeneration(code, event).catch(() => {});
    } finally {
      setSavingTimes(false);
    }
  }

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

  // Approving or rejecting a receipt (a rejection also tells the player to send a new one), or confirming without one
  async function handleReview(p: Player, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !confirm('¿Rechazar este comprobante? La persona recibe un aviso para mandar uno nuevo.')) return;
    setReviewingId(p.id);
    try {
      await reviewReceipt(code, adminToken, p.id, decision);
      if (decision === 'approve' && event) runTableGeneration(code, event).catch(() => {}); // now they are put in tables
    } catch {
      alert('No se pudo completar la acción. Probá de nuevo.');
    } finally {
      setReviewingId(null);
    }
  }

  // Reminds one player, or everyone who still owes a receipt
  async function handleRemind(p?: Player) {
    setReviewingId(p?.id ?? 'all');
    setRemindMsg('');
    try {
      const r = await remindReceipts(code, adminToken, p?.id);
      setRemindMsg(`Recordatorio enviado a ${r.devices ?? 0} dispositivo${r.devices === 1 ? '' : 's'}${r.devices === 0 ? ' (nadie tiene las notificaciones activadas: lo ven igual en su ticket)' : ''}.`);
    } catch {
      setRemindMsg('No se pudo enviar el recordatorio.');
    } finally {
      setReviewingId(null);
      setTimeout(() => setRemindMsg(''), 8000);
    }
  }

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const owingCount = players.filter((p) => owesReceipt(receiptStateOf(p, event.settings))).length;

  return (
    <main className='max-w-2xl mx-auto px-4 py-10'>
      <div className='flex items-center gap-3 mb-2'>
        <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
        <h1 className='text-xl font-bold'>Jugadores — {event.name}</h1>
        <span className='text-sm text-gray-500'>
          {confirmedPlayers(players).length}{event.settings.maxPlayers ? ` / ${event.settings.maxPlayers}` : ''}
          {tentativeCount(players) > 0 && ` · ${tentativeCount(players)} indeciso${tentativeCount(players) === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className='flex items-center gap-3 mb-6'>
        <button onClick={handleResendAll} disabled={resendingAll}
          className='text-xs border border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-800 disabled:opacity-50'>
          {resendingAll ? 'Enviando...' : '✉️ Reenviar código a todos'}
        </button>
        {resendMsg && <span className='text-xs text-gray-400'>{resendMsg}</span>}
        {owingCount > 0 && (
          <button onClick={() => handleRemind()} disabled={reviewingId === 'all'}
            className='text-xs border border-amber-700 text-amber-300 rounded-lg px-2 py-1 hover:bg-amber-950/40 disabled:opacity-50'>
            {reviewingId === 'all' ? 'Enviando...' : `🔔 Recordar comprobante a ${owingCount}`}
          </button>
        )}
        {remindMsg && <span className='text-xs text-gray-400'>{remindMsg}</span>}
      </div>

      {players.length === 0 ? (
        <p className='text-gray-500 text-center py-12'>Esperando inscriptos...</p>
      ) : (
        <div className='space-y-3'>
          {players.map((p) => {
            const tableEntries = playerTableEntries(p.id, tables);
            return (
              <AdminPlayerCard key={p.id} player={p} event={event}
                gameName={(gid) => gameMap.get(gid)?.name ?? gid} ownerOf={(gid) => gameMap.get(gid)?.ownerName ?? '?'}
                tableEntries={tableEntries} tableCounts={countByState(tableEntries)} receipt={receiptStateOf(p, event.settings)}
                editingTimes={editingTimesId === p.id} draftArrival={draftArrival} draftDeparture={draftDeparture} savingTimes={savingTimes}
                onStartEditTimes={() => startEditTimes(p)} onChangeArrival={setDraftArrival} onChangeDeparture={setDraftDeparture}
                onSaveTimes={() => saveTimes(p.id)} onCancelEditTimes={() => setEditingTimesId(null)}
                reviewing={reviewingId === p.id} resending={resendingId === p.id} deleting={deletingId === p.id}
                onViewProof={setViewingProof} onReview={(decision) => handleReview(p, decision)} onRemind={() => handleRemind(p)}
                onSetTentative={() => setPlayerRegistrationStatus(code, p.id, 'tentative')}
                onResend={() => handleResend(p)} onToggleOrganizer={() => setPlayerOrganizer(code, p.id, !p.isOrganizer)}
                onDelete={() => handleDeletePlayer(p)} />
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
