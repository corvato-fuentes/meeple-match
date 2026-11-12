'use client';
import { useState } from 'react';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';
import { isTentative, owesReceipt, type ReceiptState } from '@/lib/registration';
import type { PlayerTableState, playerTableEntries, countByState } from '@/lib/playerTables';
import type { MeepleEvent, Player } from '@/lib/types';

const TABLE_STATE_LABEL: Record<PlayerTableState, { label: string; cls: string }> = {
  confirmed: { label: '✅ Confirmada', cls: 'text-green-400' },
  accepted: { label: '⏳ Aceptó, esperando jugadores', cls: 'text-amber-300' },
  offered: { label: '🤔 Sin responder', cls: 'text-gray-300' },
  queued: { label: '⏳ En cola, espera a quien explica', cls: 'text-gray-400' },
  rejected: { label: '🚫 Rechazó', cls: 'text-gray-500' },
};
const VOTE_LABEL: Record<string, string> = { yes: '👍 Quiero jugarlo', no: '👎 No me interesa' };

type Panel = 'tables' | 'votes' | 'games' | 'contact';

/** A small bordered button for an action. */
const Pill = ({ tone, onClick, disabled, children }: {
  tone: 'green' | 'red' | 'indigo' | 'amber' | 'gray'; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) => (
  <button onClick={onClick} disabled={disabled}
    className={'text-xs rounded-lg border px-2.5 py-1 disabled:opacity-50 ' + {
      green: 'border-green-700 text-green-300 hover:bg-green-950/40',
      red: 'border-red-800 text-red-300 hover:bg-red-950/40',
      indigo: 'border-indigo-700 text-indigo-300 hover:bg-indigo-950/40',
      amber: 'border-amber-700 text-amber-300 hover:bg-amber-950/40',
      gray: 'border-gray-700 text-gray-400 hover:bg-gray-800',
    }[tone]}>
    {children}
  </button>
);

/**
 * One player on the admin's players page, in blocks instead of loose lines: who they are (with the organizer switch beside
 * the name) and their ticket code with "Reenviar código" next to it; the hours; the payment (state and what the organizer
 * can do about it); four tiles — tables, votes, games they bring, contact — each one opening its detail underneath; and,
 * apart and quiet, the occasional actions.
 */
export default function AdminPlayerCard({
  player: p, event, gameName, ownerOf, tableEntries, tableCounts, receipt,
  editingTimes, draftArrival, draftDeparture, savingTimes,
  onStartEditTimes, onChangeArrival, onChangeDeparture, onSaveTimes, onCancelEditTimes,
  reviewing, resending, deleting,
  onViewProof, onReview, onRemind, onSetTentative, onResend, onToggleOrganizer, onDelete,
}: {
  player: Player;
  event: Pick<MeepleEvent, 'startTime' | 'endTime' | 'settings'>;
  gameName: (gameId: string) => string;
  ownerOf: (gameId: string) => string;
  tableEntries: ReturnType<typeof playerTableEntries>;
  tableCounts: ReturnType<typeof countByState>;
  receipt: ReceiptState;
  editingTimes: boolean;
  draftArrival: string;
  draftDeparture: string;
  savingTimes: boolean;
  onStartEditTimes: () => void;
  onChangeArrival: (v: string) => void;
  onChangeDeparture: (v: string) => void;
  onSaveTimes: () => void;
  onCancelEditTimes: () => void;
  reviewing: boolean;
  resending: boolean;
  deleting: boolean;
  onViewProof: (url: string) => void;
  onReview: (decision: 'approve' | 'reject') => void;
  onRemind: () => void;
  onSetTentative: () => void;
  onResend: () => void;
  onToggleOrganizer: () => void;
  onDelete: () => void;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const toggle = (next: Panel) => setPanel((cur) => (cur === next ? null : next));

  const votes = Object.entries(p.interests).filter(([, v]) => v === 'yes' || v === 'no');
  const liked = votes.filter(([, v]) => v === 'yes').length;
  const owes = owesReceipt(receipt);
  const payment = receipt !== 'not-required';

  const tile = (id: Panel, icon: string, label: string, value: string, sub: string, warn = false) => (
    <button key={id} onClick={() => toggle(id)}
      className={'rounded-lg border px-2 py-1.5 text-left min-w-0 ' + (panel === id ? 'border-indigo-500 bg-indigo-950/40' : 'border-gray-700 bg-gray-900/40 hover:bg-gray-900')}>
      <span className='block text-[11px] text-gray-500'>{icon} {label}</span>
      <span className='block text-base font-semibold leading-tight'>{value}</span>
      <span className={'block text-[11px] truncate ' + (warn ? 'text-amber-400' : 'text-gray-500')}>{sub}</span>
    </button>
  );

  return (
    <div className={'border rounded-xl bg-gray-800 ' + (owes ? 'border-amber-800' : 'border-gray-700')}>
      <div className='p-4 space-y-3'>
        {/* Who they are */}
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <p className='flex flex-wrap items-center gap-x-2 gap-y-1'>
              <span className='font-semibold text-base truncate'>{p.name}</span>
              <button onClick={onToggleOrganizer} title={p.isOrganizer ? 'Quitar como organizador' : 'Marcar como organizador'}
                className={'text-xs rounded-full border px-2 py-0.5 ' + (p.isOrganizer ? 'border-amber-600 bg-amber-950/50 text-amber-300' : 'border-gray-700 text-gray-500 hover:text-gray-300')}>
                {p.isOrganizer ? '⭐ Organizador' : '☆ Organizador'}
              </button>
            </p>
            {p.alias && <p className='text-xs text-gray-500 truncate'>{p.firstName} {p.lastName}</p>}
          </div>
          <div className='shrink-0 flex flex-col items-end gap-1'>
            <span className='font-mono text-xs bg-gray-900 border border-gray-700 rounded-lg px-2 py-1' title='Código del ticket'>{p.ticketCode}</span>
            {p.email && (
              <button onClick={onResend} disabled={resending} className='text-xs text-indigo-400 hover:underline disabled:opacity-50'>
                {resending ? 'Enviando...' : '✉️ Reenviar código'}
              </button>
            )}
          </div>
        </div>

        {/* State chips */}
        <div className='flex flex-wrap gap-1.5 text-xs'>
          {isTentative(p) && <span className='bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded'>🤔 indeciso</span>}
          {receipt === 'missing' && <span className='bg-amber-900/60 text-amber-300 px-1.5 py-0.5 rounded'>💸 sin comprobante</span>}
          {receipt === 'rejected' && <span className='bg-red-900 text-red-300 px-1.5 py-0.5 rounded'>❌ comprobante rechazado</span>}
          {receipt === 'sent' && p.paymentReview === 'approved' && (
            <span className='bg-green-900 text-green-300 px-1.5 py-0.5 rounded'>{p.paymentProofUrl ? '✅ pago aprobado' : '✅ pago confirmado'}</span>
          )}
          {/* Confirmed by an organizer without a receipt (e.g. paid in person): shown as such, for reference only */}
          {receipt === 'sent' && p.paymentReview === 'approved' && !p.paymentProofUrl && <span className='bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded'>sin comprobante</span>}
          {receipt === 'sent' && p.paymentReview !== 'approved' && <span className='bg-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded'>🧾 por revisar</span>}
          {tableCounts.confirmed > 0 && <span className='bg-gray-900 text-green-400 px-1.5 py-0.5 rounded'>🪑 {tableCounts.confirmed} mesa{tableCounts.confirmed !== 1 ? 's' : ''} confirmada{tableCounts.confirmed !== 1 ? 's' : ''}</span>}
        </div>

        {/* Hours */}
        {editingTimes ? (
          <div className='border border-gray-700 rounded-xl p-3 bg-gray-900 space-y-2 max-w-xs'>
            <div className='grid grid-cols-2 gap-2'>
              <div>
                <label className='text-xs text-gray-400'>Llega</label>
                <TimeWheelPicker value={draftArrival} onChange={onChangeArrival} minTime={event.startTime} maxTime={event.endTime} />
              </div>
              <div>
                <label className='text-xs text-gray-400'>Se va</label>
                <TimeWheelPicker value={draftDeparture} onChange={onChangeDeparture} minTime={event.startTime} maxTime={event.endTime} />
              </div>
            </div>
            <div className='flex gap-2'>
              <button onClick={onCancelEditTimes} className='flex-1 border border-gray-700 rounded-lg py-1 text-xs font-medium'>Cancelar</button>
              <button onClick={onSaveTimes} disabled={savingTimes}
                className='flex-1 bg-indigo-600 rounded-lg py-1 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50'>
                {savingTimes ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : (
          <p className='text-sm text-gray-300'>
            🕐 {p.arrivalTime}–{p.departureTime}
            <button onClick={onStartEditTimes} className='ml-2 text-xs text-indigo-400 hover:underline'>✏️ editar</button>
          </p>
        )}

        {/* Payment: the state is in the chips above; this is what the organizer can do about it */}
        {payment && (
          <div className='rounded-lg border border-gray-700 bg-gray-900/50 p-2 flex flex-wrap items-center gap-2'>
            <span className='text-xs text-gray-500 mr-1'>💳 Pago</span>
            {p.paymentProofUrl && <Pill tone='indigo' onClick={() => onViewProof(p.paymentProofUrl!)}>🧾 Ver comprobante</Pill>}
            {p.paymentProofUrl && p.paymentReview !== 'approved' && <Pill tone='green' onClick={() => onReview('approve')} disabled={reviewing}>✅ Aprobar</Pill>}
            {p.paymentProofUrl && p.paymentReview !== 'rejected' && <Pill tone='red' onClick={() => onReview('reject')} disabled={reviewing}>❌ Rechazar</Pill>}
            {!p.paymentProofUrl && receipt === 'missing' && <Pill tone='green' onClick={() => onReview('approve')} disabled={reviewing}>✅ Confirmar sin comprobante</Pill>}
            {owes && <Pill tone='amber' onClick={onRemind} disabled={reviewing}>🔔 Recordar</Pill>}
            {!owes && !p.paymentProofUrl && <span className='text-xs text-gray-500'>Sin comprobante cargado</span>}
          </div>
        )}

        {/* Tiles: each opens its detail below */}
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
          {tile('tables', '🪑', 'Mesas', String(tableEntries.length), tableEntries.length === 0 ? 'ninguna todavía' : `${tableCounts.confirmed} confirmada${tableCounts.confirmed !== 1 ? 's' : ''}`)}
          {tile('votes', '🗳️', 'Votos', String(votes.length), votes.length === 0 ? '⚠️ no votó nada' : `${liked} 👍`, votes.length === 0)}
          {tile('games', '🎲', 'Trae', String(p.bringGameIds.length), p.bringGameIds.length === 1 ? 'juego' : 'juegos')}
          {tile('contact', '📇', 'Contacto', p.phone ? '📞' : '—', p.email ?? (p.phone ? 'sin email' : 'sin datos'))}
        </div>

        {panel === 'tables' && (
          <div className='space-y-1'>
            {tableEntries.length > 0 && (
              <p className='text-[11px] text-gray-500'>
                {[
                  tableCounts.confirmed > 0 && `✅ ${tableCounts.confirmed} confirmada${tableCounts.confirmed !== 1 ? 's' : ''}`,
                  tableCounts.accepted > 0 && `⏳ ${tableCounts.accepted} esperando jugadores`,
                  tableCounts.offered > 0 && `🤔 ${tableCounts.offered} sin responder`,
                  tableCounts.queued > 0 && `⏳ ${tableCounts.queued} en cola`,
                  tableCounts.rejected > 0 && `🚫 ${tableCounts.rejected} rechazada${tableCounts.rejected !== 1 ? 's' : ''}`,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            {tableEntries.length === 0 && <p className='text-xs text-gray-500'>Sin mesas todavía.</p>}
            {tableEntries.map(({ table: t, state, explains }) => (
              <div key={t.id} className='flex items-center justify-between gap-2 text-xs text-gray-300 bg-gray-900 rounded-lg px-2 py-1'>
                <span className='min-w-0 truncate'>
                  {t.gameName} <span className='text-gray-500'>· {t.startTime}–{t.endTime}</span>
                  {explains && <span className='text-purple-300'> · explica</span>}
                </span>
                <span className={'shrink-0 ' + TABLE_STATE_LABEL[state].cls}>{TABLE_STATE_LABEL[state].label}</span>
              </div>
            ))}
          </div>
        )}
        {panel === 'votes' && (
          <div className='space-y-1'>
            {votes.length === 0 && <p className='text-xs text-amber-400'>⚠️ No votó ningún juego.</p>}
            {votes.map(([gid, level]) => (
              <div key={gid} className='flex items-center justify-between text-xs text-gray-300 bg-gray-900 rounded-lg px-2 py-1'>
                <span>{gameName(gid)} <span className='text-gray-500'>({ownerOf(gid)})</span></span>
                <span className='flex items-center gap-1.5 shrink-0'>
                  {VOTE_LABEL[level] ?? level}
                  {p.canExplain.includes(gid) && <span className='text-purple-300'>explica</span>}
                  {(p.repeatGameIds ?? []).includes(gid) && <span className='text-indigo-300'>🔁</span>}
                </span>
              </div>
            ))}
          </div>
        )}
        {panel === 'games' && (
          <div className='flex flex-wrap gap-1'>
            {p.bringGameIds.length === 0 && <p className='text-xs text-gray-500'>No trae juegos.</p>}
            {p.bringGameIds.map((gid) => (
              <span key={gid} className='text-xs bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded-full'>{gameName(gid)}</span>
            ))}
          </div>
        )}
        {panel === 'contact' && (
          <div className='text-xs text-gray-300 space-y-0.5 bg-gray-900 rounded-lg px-2 py-1.5'>
            <p>✉️ {p.email ?? 'sin email'}</p>
            <p>📞 {p.phone ?? 'sin teléfono'}</p>
            {p.registeredAt?.toDate && <p className='text-gray-500'>Se inscribió {p.registeredAt.toDate().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</p>}
          </div>
        )}
      </div>

      {/* Occasional actions, apart from the rest */}
      <div className='border-t border-gray-700 px-4 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
          {!isTentative(p) && event.settings.flexibleRegistration && (
            <button onClick={onSetTentative} className='text-xs text-gray-400 hover:underline'>🤔 Pasar a indeciso</button>
          )}
        </div>
        <button onClick={onDelete} disabled={deleting} className='text-xs text-red-400 hover:underline disabled:opacity-50'>
          {deleting ? 'Eliminando...' : '🗑️ Eliminar'}
        </button>
      </div>
    </div>
  );
}
