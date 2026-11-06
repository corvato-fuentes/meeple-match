'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { buildCheckinPayload } from '@/lib/checkin';

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The player's check-in QR, shown right inside the ticket card (it is the "pass" they show at the door),
 * plus the check-in status: once the organizer has scanned it, it says so by itself.
 */
export default function TicketQr({ code, ticketCode }: { code: string; ticketCode: string }) {
  const [qr, setQr] = useState<string | null>(null);
  // undefined = not known yet, null = not checked in, number = checked in at that time
  const [checkedInAt, setCheckedInAt] = useState<number | null | undefined>(undefined);

  // Is this ticket checked in? Looked up on load and re-checked every few seconds, so it flips to ✅ right
  // after the organizer scans it.
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/checkin?code=${encodeURIComponent(code)}&ticket=${encodeURIComponent(ticketCode)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { checkedInAt?: number | null } | null) => { if (!cancelled && json) setCheckedInAt(json.checkedInAt ?? null); })
      .catch(() => {});
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [code, ticketCode]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(buildCheckinPayload(code, ticketCode), { width: 480, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code, ticketCode]);

  const arrived = typeof checkedInAt === 'number';
  return (
    <div className="mt-3">
      <div className={`relative mx-auto w-44 h-44 bg-white rounded-xl p-1.5 flex items-center justify-center ${arrived ? 'opacity-40' : ''}`}>
        {qr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={qr} alt={`QR de entrada, ticket ${ticketCode}`} className="w-full h-full" />
          : <span className="text-xs text-gray-500">Generando…</span>}
      </div>
      {arrived && <p className="text-green-300 text-xs font-medium mt-2">✅ Check-in hecho a las {timeOf(checkedInAt)}</p>}
    </div>
  );
}
