'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildCheckinPayload } from '@/lib/checkin';

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The player's check-in QR (shown full size in a popup, to be scanned at the door) plus the check-in status.
 * Renders the button that opens it; once the organizer has checked the player in it turns into "✅ Check-in hecho".
 */
export default function TicketQr({ code, ticketCode, playerName }: { code: string; ticketCode: string; playerName: string }) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  // undefined = not known yet, null = not checked in, number = checked in at that time
  const [checkedInAt, setCheckedInAt] = useState<number | null | undefined>(undefined);

  // Is this ticket checked in? Looked up on load and re-checked while the popup is open (so it flips to ✅ by itself
  // right after the organizer scans it), and every minute otherwise.
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/checkin?code=${encodeURIComponent(code)}&ticket=${encodeURIComponent(ticketCode)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { checkedInAt?: number | null } | null) => { if (!cancelled && json) setCheckedInAt(json.checkedInAt ?? null); })
      .catch(() => {});
    void load();
    const timer = setInterval(load, open ? 4000 : 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [code, ticketCode, open]);

  // The QR itself is drawn the first time the popup opens
  useEffect(() => {
    if (!open || qr) return;
    let cancelled = false;
    QRCode.toDataURL(buildCheckinPayload(code, ticketCode), { width: 520, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, qr, code, ticketCode]);

  const arrived = typeof checkedInAt === 'number';
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`text-center text-sm border rounded-xl px-3 py-1.5 hover:bg-gray-800 ${arrived ? 'border-green-700 text-green-300' : 'border-gray-700'}`}>
        {arrived ? '✅ Check-in hecho' : '🎟️ Mi QR de entrada'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)}
          role="dialog" aria-modal="true" aria-label="QR de check-in">
          <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-3 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-100">{playerName}</h3>
            {arrived ? (
              <p className="text-green-300 text-sm font-medium">✅ Ya hiciste el check-in a las {timeOf(checkedInAt)}</p>
            ) : (
              <p className="text-xs text-gray-400">Mostrale este QR a los organizadores al llegar para registrar tu entrada.</p>
            )}
            <div className="mx-auto w-64 h-64 bg-white rounded-xl p-2 flex items-center justify-center">
              {qr
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={qr} alt={`QR de entrada, ticket ${ticketCode}`} className="w-full h-full" />
                : <span className="text-xs text-gray-500">Generando…</span>}
            </div>
            <p className="font-mono tracking-widest text-indigo-300">{ticketCode}</p>
            <p className="text-[11px] text-gray-500">Si no se puede escanear, dales este código y lo cargan a mano.</p>
            <button onClick={() => setOpen(false)}
              className="w-full border border-gray-700 rounded-lg py-2 text-sm text-gray-300 hover:bg-gray-800">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
