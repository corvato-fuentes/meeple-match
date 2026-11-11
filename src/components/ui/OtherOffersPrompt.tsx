'use client';
import type { Table } from '@/lib/types';

/**
 * Right after the player accepts a table of a game, asks about the OTHER table of that same game they were also offered
 * (instead of a generic "do you want a second table?"): join it too, or turn it down. One at a time; "Decidir después"
 * leaves it waiting in their offers.
 */
export default function OtherOffersPrompt({ offers, busy, onAccept, onReject, onLater }: {
  offers: Table[];
  busy?: boolean;
  onAccept: (t: Table) => void;
  onReject: (t: Table) => void;
  onLater: () => void;
}) {
  const t = offers[0];
  if (!t) return null;
  const time = `${t.startTime}–${t.endTime}`;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onLater}
      role="dialog" aria-modal="true" aria-label="Otra mesa ofrecida del mismo juego">
      <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-100">También te ofrecieron otra mesa de {t.gameName}</h3>
        <p className="text-xs text-gray-400">
          Ya aceptaste una mesa de este juego. Tenés ofrecida otra de <strong className="text-gray-300">{time}</strong>
          {t.postedByOwner ? ' (la armó su dueño)' : ''}. ¿Te sumás también?
          {offers.length > 1 && <> Hay {offers.length - 1} más para responder después.</>}
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={() => onAccept(t)} disabled={busy}
            className="w-full bg-indigo-600 rounded-lg py-2.5 px-3 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50">
            ✅ Sumarme también a la de {time}
          </button>
          <button onClick={() => onReject(t)} disabled={busy}
            className="w-full border border-gray-700 rounded-lg py-2.5 px-3 text-xs font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
            ❌ Rechazar la de {time}
          </button>
          <button onClick={onLater} className="w-full text-xs text-gray-500 hover:text-gray-300 py-1">Decidir después</button>
        </div>
      </div>
    </div>
  );
}
