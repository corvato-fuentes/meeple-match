'use client';
import { useState } from 'react';
import { sendReceipt } from '@/lib/receipt';
import type { ReceiptState } from '@/lib/registration';
import type { MeepleEvent, Player } from '@/lib/types';

const TEXTS = {
  tentative: {
    title: '🤔 Estás anotado como indeciso',
    body: 'Podés votar juegos y sumar los tuyos, pero tu lugar no está reservado y todavía no se te arman mesas. Para confirmar tu inscripción mandá el comprobante de pago.',
  },
  missing: {
    title: '💸 Falta tu comprobante de pago',
    body: 'Este evento pide comprobante de pago. Mandalo para confirmar tu lugar.',
  },
  rejected: {
    title: '⚠️ Tu comprobante fue rechazado',
    body: 'Un organizador no pudo validar el comprobante que mandaste. Mandá uno nuevo para confirmar tu lugar.',
  },
} as const;

/**
 * Shown on the ticket of someone who owes a receipt — registered as "indeciso", registered before the event asked for one,
 * or whose receipt was rejected — and lets them send it right here. `onSent` runs with the saved receipt's address.
 */
export default function ReceiptBanner({ code, player, event, state, onSent }: {
  code: string;
  player: Pick<Player, 'id' | 'ticketCode' | 'registrationStatus'>;
  event: Pick<MeepleEvent, 'settings'>;
  /** What is owed: never sent, or sent and rejected. */
  state: Extract<ReceiptState, 'missing' | 'rejected'>;
  onSent: (url: string) => void;
}) {
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
    <section id="enviar-comprobante" className="scroll-mt-4 border border-amber-700 bg-amber-950/30 rounded-xl p-4 space-y-2">
      <h2 className="font-semibold text-amber-300">{text.title}</h2>
      <p className="text-xs text-gray-300">{text.body}</p>
      {event.settings.paymentInfo && <p className="text-xs text-gray-300 whitespace-pre-wrap">{event.settings.paymentInfo}</p>}
      <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-indigo-700" />
      <button onClick={send} disabled={!file || sending}
        className="w-full bg-indigo-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40">
        {sending ? 'Enviando...' : '💸 Enviar comprobante'}
      </button>
      {message && <p className="text-xs text-amber-300">{message}</p>}
    </section>
  );
}
