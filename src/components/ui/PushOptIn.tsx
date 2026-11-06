'use client';
import { useEffect, useState } from 'react';
import { getPushStatus, enablePush, disablePush, syncExistingSubscription, type PushStatus } from '@/lib/pushClient';
import { readStore, writeStore } from '@/lib/pwa';

const SNOOZE_KEY = 'mm_push_snoozed_until';
const SNOOZE_DAYS = 7;

// "X minutes before" reminders are time-based: they only go out reliably once something pings the
// server every few minutes on event day (see /api/cron/push-reminders). Until the deployment has
// that scheduler, the card doesn't promise them — set NEXT_PUBLIC_PUSH_REMINDERS=1 once it does.
const REMINDERS_PROMISED = process.env.NEXT_PUBLIC_PUSH_REMINDERS === '1';

const snoozed = () => Number(readStore(SNOOZE_KEY) ?? 0) > Date.now();
const snooze = () => writeStore(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));

interface Props {
  code: string;
  ticketCode: string;
  /**
   * 'ticket': always-there control on the ticket page (offer card, or the on / blocked / install note).
   * 'prompt': only the offer card, for the moment right after the player accepts a table.
   */
  variant?: 'ticket' | 'prompt';
}

/** Lets the player turn on notifications for their tables (offers, confirmations, reminders). */
export default function PushOptIn({ code, ticketCode, variant = 'ticket' }: Props) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPushStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        // Already on in this browser (maybe for another event or ticket): make sure THIS ticket is registered too
        if (s === 'on') syncExistingSubscription(code, ticketCode).catch(() => {});
      })
      .catch(() => { if (!cancelled) setStatus('unsupported'); });
    return () => { cancelled = true; };
  }, [code, ticketCode]);

  async function turnOn() {
    setBusy(true);
    setFailed(false);
    const result = await enablePush(code, ticketCode);
    if (result === 'on') setStatus('on');
    else if (result === 'blocked') setStatus('blocked');
    else if (result === 'error') setFailed(true);
    // 'dismissed' = they closed the permission prompt without choosing: nothing to report, the card stays
    setBusy(false);
  }
  async function turnOff() {
    setBusy(true);
    setStatus(await disablePush(code, ticketCode));
    setBusy(false);
  }

  if (!status || status === 'unsupported' || hidden) return null;

  if (status === 'off') {
    // The ticket page respects "Ahora no"; right after accepting a table it asks regardless.
    if (variant === 'ticket' && snoozed()) return null;
    return (
      <section className="border border-amber-700 bg-amber-950/20 rounded-2xl p-4 space-y-3 text-sm">
        <div>
          <p className="font-semibold text-amber-300">🔔 Activá los avisos</p>
          <p className="text-gray-400 mt-1">
            Te avisamos cuando te ofrecen una mesa y cuando se confirma{REMINDERS_PROMISED ? ', y unos minutos antes de que empiece' : ''}. Sin spam: solo eso.
          </p>
        </div>
        {failed && (
          <p className="text-xs text-red-300">
            No se pudieron activar. Revisá que los avisos estén permitidos para este sitio en tu navegador e intentá de nuevo.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={() => { snooze(); setHidden(true); }} disabled={busy}
            className="flex-1 border border-gray-700 rounded-lg py-2 text-gray-300 hover:bg-gray-800 disabled:opacity-50">
            Ahora no
          </button>
          <button onClick={turnOn} disabled={busy}
            className="flex-1 bg-amber-600 text-black rounded-lg py-2 font-semibold hover:bg-amber-500 disabled:opacity-50">
            {busy ? 'Activando…' : 'Activar avisos'}
          </button>
        </div>
      </section>
    );
  }

  if (variant === 'prompt') return null;

  if (status === 'on') {
    return (
      <p className="text-xs text-gray-500 text-center">
        🔔 Avisos activados en este teléfono ·{' '}
        <button onClick={turnOff} disabled={busy} className="text-indigo-400 hover:underline disabled:opacity-50">Desactivar</button>
      </p>
    );
  }
  if (status === 'blocked') {
    return <p className="text-xs text-gray-500 text-center">🔕 Los avisos están bloqueados en este navegador. Para recibirlos, permitilos desde los ajustes del sitio.</p>;
  }
  // 'needs-install' — iPhone only allows web notifications once the app is on the home screen
  return (
    <p className="text-xs text-gray-500 text-center">
      🔔 Para recibir avisos de tus mesas en iPhone, primero instalá la app: tocá Compartir y «Agregar a pantalla de inicio».
    </p>
  );
}
