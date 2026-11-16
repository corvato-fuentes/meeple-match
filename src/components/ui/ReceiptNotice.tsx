'use client';
import { useState } from 'react';
import { sendReceipt } from '@/lib/receipt';
import { setContributionDeclined } from '@/lib/firestore';
import PaymentDetails from '@/components/ui/PaymentDetails';
import { flexibleRegistrationOn, type ReceiptState } from '@/lib/registration';
import type { MeepleEvent, Player } from '@/lib/types';

const TEXTS = {
  tentative: {
    title: '⚠️ Tu lugar no está confirmado',
    body: 'Estás como indeciso: el lugar no está reservado y no se te arman mesas hasta que mandes el comprobante de pago.',
  },
  missing: {
    title: '⚠️ Falta tu comprobante de pago',
    body: 'Este evento pide comprobante de pago. Mandalo para confirmar tu lugar.',
  },
  // Flexible registration: they said they are coming and chose to contribute later; the place is theirs
  contributionPending: {
    title: '💸 Tu contribución está pendiente',
    body: 'Tu lugar está reservado. Cuando contribuyas, mandá el comprobante desde acá.',
  },
  // Flexible registration: they chose not to contribute; the place stays theirs and nothing is asked of them
  declined: {
    title: '💸 Elegiste no contribuir',
    body: 'Tu lugar sigue reservado. Si cambiás de idea, podés mandar el comprobante cuando quieras.',
  },
  rejected: {
    title: '⚠️ Tu comprobante fue rechazado',
    body: 'Un organizador no pudo validar el comprobante que mandaste. Mandá uno nuevo para confirmar tu lugar.',
  },
} as const;

/**
 * The notice inside the ticket card for someone who owes a receipt — registered as "indeciso", registered before the event
 * asked for one, or whose receipt was rejected. Tapping it opens the way to send the receipt right there, so the ticket
 * doesn't need a separate card for it. `onSent` runs with the saved receipt's address.
 */
export default function ReceiptNotice({ code, player, event, state, onSent, onDeclinedChange }: {
  code: string;
  player: Pick<Player, 'id' | 'ticketCode' | 'registrationStatus'>;
  event: Pick<MeepleEvent, 'settings'>;
  /** What is owed: never sent, or sent and rejected. */
  state: Extract<ReceiptState, 'missing' | 'rejected' | 'declined'>;
  onSent: (url: string) => void;
  /** Flexible registration: they chose not to contribute (true) or went back to leaving it pending (false). */
  onDeclinedChange?: (declined: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const declined = state === 'declined';
  // Only someone who holds a place can pass on contributing: an indeciso confirms by sending the receipt, and a rejected receipt needs a new one
  const canDecline = !!onDeclinedChange && state === 'missing' && player.registrationStatus !== 'tentative' && flexibleRegistrationOn(event.settings);
  const text = declined ? TEXTS.declined
    : state === 'rejected' ? TEXTS.rejected
    : player.registrationStatus === 'tentative' ? TEXTS.tentative
    : flexibleRegistrationOn(event.settings) ? TEXTS.contributionPending : TEXTS.missing;

  async function send() {
    if (!file || sending) return;
    setSending(true);
    setMessage('');
    try {
      const result = await sendReceipt(code, player, file);
      if (!result.ok) setMessage('El evento ya tiene todos los lugares confirmados. Seguís como indeciso, sujeto a disponibilidad: los organizadores te avisan si se libera uno.');
      else onSent(result.url);
    } catch {
      setMessage('No se pudo enviar el comprobante. Probá de nuevo.');
    } finally {
      setSending(false);
    }
  }

  const [saving, setSaving] = useState(false);
  async function changeDeclined(value: boolean) {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await setContributionDeclined(code, player.id, value);
      onDeclinedChange?.(value);
    } catch {
      setMessage('No se pudo guardar. Probá de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={'mt-3 border rounded-xl text-left ' + (declined ? 'border-gray-700 bg-gray-900/40' : 'border-amber-700 bg-amber-950/40')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left px-3 py-2">
        <span className="flex items-center justify-between gap-2">
          <span className={'text-sm font-semibold ' + (declined ? 'text-gray-200' : 'text-amber-300')}>{text.title}</span>
          <span className={'text-xs ' + (declined ? 'text-gray-400' : 'text-amber-300')} aria-hidden="true">{open ? '▴' : '▾'}</span>
        </span>
        <span className="block text-xs text-gray-300 mt-0.5">{text.body}</span>
        {!open && <span className="block text-xs text-indigo-300 mt-1">Tocá acá para enviar el comprobante</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-amber-900/60">
          <PaymentDetails alias={event.settings.paymentAlias} info={event.settings.paymentInfo} />
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-indigo-700" />
          <button onClick={send} disabled={!file || sending}
            className="w-full bg-indigo-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40">
            {sending ? 'Enviando...' : '💸 Enviar comprobante'}
          </button>
          {canDecline && (
            <button type="button" onClick={() => changeDeclined(true)} disabled={saving || sending}
              className="w-full border border-gray-700 rounded-xl py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40">
              {saving ? 'Guardando...' : 'Prefiero no contribuir'}
            </button>
          )}
          {declined && onDeclinedChange && (
            <button type="button" onClick={() => changeDeclined(false)} disabled={saving || sending}
              className="w-full text-xs text-indigo-400 hover:underline disabled:opacity-40">
              ← Dejarlo pendiente otra vez
            </button>
          )}
          {message && <p className="text-xs text-amber-300">{message}</p>}
        </div>
      )}
    </div>
  );
}
