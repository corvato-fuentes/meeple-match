'use client';
import { useState } from 'react';
import { sendReceipt } from '@/lib/receipt';
import PaymentDetails from '@/components/ui/PaymentDetails';
import type { ReceiptState } from '@/lib/registration';
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
export default function ReceiptNotice({ code, player, event, state, onSent }: {
  code: string;
  player: Pick<Player, 'id' | 'ticketCode' | 'registrationStatus'>;
  event: Pick<MeepleEvent, 'settings'>;
  /** What is owed: never sent, or sent and rejected. */
  state: Extract<ReceiptState, 'missing' | 'rejected'>;
  onSent: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const text = state === 'rejected' ? TEXTS.rejected : player.registrationStatus === 'tentative' ? TEXTS.tentative : TEXTS.missing;

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

  return (
    <div className="mt-3 border border-amber-700 bg-amber-950/40 rounded-xl text-left">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left px-3 py-2">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-amber-300">{text.title}</span>
          <span className="text-amber-300 text-xs" aria-hidden="true">{open ? '▴' : '▾'}</span>
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
          {message && <p className="text-xs text-amber-300">{message}</p>}
        </div>
      )}
    </div>
  );
}
