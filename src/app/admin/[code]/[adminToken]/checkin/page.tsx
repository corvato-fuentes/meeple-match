'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken } from '@/lib/firestore';
import { parseCheckinPayload } from '@/lib/checkin';
import QrScanner from '@/components/ui/QrScanner';
import type { MeepleEvent } from '@/lib/types';

interface Row { id: string; name: string; checkedInAt: number | null; hasProof: boolean }
interface Review { id: string; name: string; proofUrl: string | null }
type Filter = 'missing' | 'arrived' | 'all';
/** `undoId`: the player the message is about, so the banner can offer to take that check-in back right there. */
type Banner = { kind: 'ok' | 'already' | 'error'; text: string; undoId?: string };

const REFRESH_MS = 15_000;
// While the camera stays pointed at a QR it keeps reading it: the same ticket is ignored for this long after a scan,
// so the "check-in hecho" message isn't replaced by "ya había hecho el check-in" a moment later.
const RESCAN_IGNORE_MS = 10_000;
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** The door: scan each player's QR (or type their code / tap their name) and see who has arrived. */
export default function CheckInPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [manual, setManual] = useState('');
  const [filter, setFilter] = useState<Filter>('missing');
  const [search, setSearch] = useState('');
  // Events that ask for a payment proof: a scan opens this card instead of checking the player in right away
  const [review, setReview] = useState<Review | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const reviewing = useRef(false);
  const busy = useRef(false);
  const lastScan = useRef({ text: '', at: 0 });

  const listUrl = `/api/admin/checkin?code=${encodeURIComponent(code)}&adminToken=${encodeURIComponent(adminToken)}`;

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      setAuthorized(ok);
      if (ok) setEvent(await getEvent(code));
    });
  }, [code, adminToken]);

  // The list of players with their arrival, refreshed on its own so two organizers at the door see each other's scans
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    const load = () => fetch(listUrl).then((res) => (res.ok ? res.json() : null))
      .then((json: { players?: Row[] } | null) => { if (!cancelled && json?.players) setRows(json.players); })
      .catch(() => {});
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [authorized, listUrl]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(listUrl);
      if (res.ok) setRows((await res.json()).players);
    } catch { /* the next refresh will catch up */ }
  }, [listUrl]);

  async function send(payload: { ticketCode?: string; playerId?: string; undo?: boolean }): Promise<Banner> {
    try {
      const res = await fetch('/api/admin/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, adminToken, ...payload }),
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; player?: { id: string; name: string }; at?: number; already?: boolean; undone?: boolean } | null;
      if (res.status === 404) return { kind: 'error', text: 'No hay ningún jugador con ese ticket en este evento.' };
      if (!res.ok || !json?.ok || !json.player) return { kind: 'error', text: 'No se pudo registrar. Intentá de nuevo.' };
      await reload();
      if (json.undone) return { kind: 'ok', text: `Se deshizo el check-in de ${json.player.name}.` };
      if (json.already) return { kind: 'already', text: `${json.player.name} ya había hecho el check-in a las ${timeOf(json.at!)}.`, undoId: json.player.id };
      navigator.vibrate?.(60);
      return { kind: 'ok', text: `✅ ${json.player.name} — check-in hecho (${timeOf(json.at!)})`, undoId: json.player.id };
    } catch {
      return { kind: 'error', text: 'No se pudo registrar. Revisá tu conexión e intentá de nuevo.' };
    }
  }

  /** "Deshacer" on the message that follows a check-in (a scan or a typed code), so a wrong one can be undone at once. */
  async function undoFromBanner(playerId: string) {
    if (busy.current) return;
    busy.current = true;
    try {
      lastScan.current = { text: '', at: 0 }; // so the same QR can be scanned again right away
      setBanner(await send({ playerId, undo: true }));
    } finally {
      busy.current = false;
    }
  }

  function closeReview() {
    reviewing.current = false;
    setReview(null);
    setProofOpen(false);
  }

  /**
   * Checks someone in. When the event asks for a payment proof, nothing is written yet: the organizer first gets a
   * card to look at the proof and decide (see `review`). Someone who already arrived just gets the usual notice.
   */
  async function process(ref: { ticketCode?: string; playerId?: string }): Promise<Banner | null> {
    if (!event?.settings.paymentRequired) return send(ref);
    try {
      const res = await fetch('/api/admin/checkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, adminToken, preview: true, ...ref }),
      });
      if (res.status === 404) return { kind: 'error', text: 'No hay ningún jugador con ese ticket en este evento.' };
      const json = await res.json().catch(() => null) as { ok?: boolean; player?: { id: string; name: string; proofUrl: string | null; checkedInAt: number | null } } | null;
      if (!res.ok || !json?.ok || !json.player) return { kind: 'error', text: 'No se pudo consultar el ticket. Intentá de nuevo.' };
      const p = json.player;
      if (p.checkedInAt != null) return { kind: 'already', text: `${p.name} ya había hecho el check-in a las ${timeOf(p.checkedInAt)}.` };
      reviewing.current = true;
      setBanner(null);
      setReview({ id: p.id, name: p.name, proofUrl: p.proofUrl });
      return null;
    } catch {
      return { kind: 'error', text: 'No se pudo consultar el ticket. Revisá tu conexión e intentá de nuevo.' };
    }
  }

  async function confirmReview() {
    if (!review || busy.current) return;
    busy.current = true;
    try {
      setBanner(await send({ playerId: review.id }));
      closeReview();
    } finally {
      busy.current = false;
    }
  }

  async function handleScan(text: string) {
    if (busy.current || reviewing.current) return;
    if (text === lastScan.current.text && Date.now() - lastScan.current.at < RESCAN_IGNORE_MS) return;
    lastScan.current = { text, at: Date.now() };
    busy.current = true;
    try {
      const parsed = parseCheckinPayload(text);
      if (!parsed) setBanner({ kind: 'error', text: 'Ese QR no es de un ticket de Meeple Loop.' });
      else if (parsed.eventCode.toUpperCase() !== code.toUpperCase()) setBanner({ kind: 'error', text: 'Ese QR es de otro evento.' });
      else { const result = await process({ ticketCode: parsed.ticketCode }); if (result) setBanner(result); }
    } finally {
      busy.current = false;
    }
  }

  async function handleManual(e: React.FormEvent) {
    e.preventDefault();
    const ticketCode = manual.trim().toUpperCase();
    if (!ticketCode || busy.current || reviewing.current) return;
    busy.current = true;
    try {
      const result = await process({ ticketCode });
      if (result) setBanner(result);
      setManual('');
    } finally {
      busy.current = false;
    }
  }

  async function handleRow(row: Row) {
    if (busy.current || reviewing.current) return;
    busy.current = true;
    try {
      const result = row.checkedInAt != null ? await send({ playerId: row.id, undo: true }) : await process({ playerId: row.id });
      if (result) setBanner(result);
    } finally {
      busy.current = false;
    }
  }

  if (authorized === false) return <div className="p-8 text-center text-red-500">Acceso denegado.</div>;
  if (authorized === null || !event) return <div className="p-8 text-center">Cargando...</div>;

  const arrived = rows?.filter((r) => r.checkedInAt != null).length ?? 0;
  const total = rows?.length ?? 0;
  const needle = search.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) =>
    (filter === 'all' || (filter === 'arrived') === (r.checkedInAt != null)) && (!needle || r.name.toLowerCase().includes(needle)));
  const bannerStyle = { ok: 'border-green-700 bg-green-950/40 text-green-200', already: 'border-amber-700 bg-amber-950/40 text-amber-200', error: 'border-red-800 bg-red-950/40 text-red-200' };

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/admin/${code}/${adminToken}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">Check-in — {event.name}</h1>
      </div>

      <section className="border border-gray-700 rounded-xl p-4 space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold">✅ {arrived} de {total} llegaron</p>
          <p className="text-xs text-gray-500">{total - arrived} faltan</p>
        </div>
        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full bg-green-600 transition-all" style={{ width: total ? `${(arrived / total) * 100}%` : '0%' }} />
        </div>
      </section>

      <section className="border border-gray-700 rounded-xl p-4 space-y-3">
        {scanning ? (
          <>
            <QrScanner onScan={handleScan} />
            <button onClick={() => setScanning(false)} className="w-full border border-gray-700 rounded-lg py-2 text-sm text-gray-300 hover:bg-gray-800">
              Cerrar la cámara
            </button>
          </>
        ) : (
          <button onClick={() => setScanning(true)} className="w-full bg-indigo-600 text-white rounded-lg py-3 font-semibold hover:bg-indigo-700">
            📷 Escanear QR de un ticket
          </button>
        )}
        {review && (
          <div className="border border-indigo-500/60 bg-indigo-950/30 rounded-xl p-3 space-y-3" role="group" aria-label="Revisar comprobante">
            <p className="font-semibold text-gray-100">{review.name}</p>
            {review.proofUrl ? (
              <button onClick={() => setProofOpen(true)}
                className="w-full border border-indigo-500 text-indigo-300 rounded-lg py-2 text-sm font-medium hover:bg-indigo-950/60">
                🧾 Ver comprobante de pago
              </button>
            ) : (
              <p className="text-sm text-amber-300 bg-amber-950/30 border border-amber-800 rounded-lg px-3 py-2">⚠️ No hay comprobante de pago cargado.</p>
            )}
            <div className="flex gap-2">
              <button onClick={closeReview}
                className="flex-1 border border-gray-700 rounded-lg py-2 text-sm text-gray-300 hover:bg-gray-800">
                No registrar
              </button>
              <button onClick={confirmReview}
                className="flex-1 bg-green-700 text-white rounded-lg py-2 text-sm font-semibold hover:bg-green-600">
                ✅ Marcar presente
              </button>
            </div>
          </div>
        )}
        {banner && !review && (
          <div className={`flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm ${bannerStyle[banner.kind]}`}>
            <p role="status">{banner.text}</p>
            {banner.undoId && (
              <button onClick={() => undoFromBanner(banner.undoId!)}
                className="shrink-0 border border-current rounded-lg px-3 py-1 text-xs font-medium hover:bg-white/10">
                Deshacer
              </button>
            )}
          </div>
        )}
        <form onSubmit={handleManual} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="O escribí el código del ticket" maxLength={8}
            autoCapitalize="characters" autoComplete="off"
            className="flex-1 min-w-0 border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-widest" />
          <button type="submit" disabled={!manual.trim()}
            className="border border-gray-700 rounded-lg px-4 text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
            Cargar
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {([['missing', 'Faltan'], ['arrived', 'Llegaron'], ['all', 'Todos']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === key ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}>
              {label}
            </button>
          ))}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre"
            className="flex-1 min-w-[8rem] border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        {rows === null ? (
          <p className="text-sm text-gray-500 text-center py-6">Cargando jugadores…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
            {filter === 'missing' && !needle ? '¡Llegaron todos! 🎉' : 'No hay nadie en esta lista.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 border border-gray-800 rounded-lg px-3 py-2 bg-gray-900/40">
                <div className="min-w-0">
                  <p className="text-sm truncate">{r.name}</p>
                  {r.checkedInAt != null && <p className="text-xs text-green-400">Llegó a las {timeOf(r.checkedInAt)}</p>}
                  {event.settings.paymentRequired && r.checkedInAt == null && !r.hasProof && <p className="text-xs text-amber-400">Sin comprobante</p>}
                </div>
                <button onClick={() => handleRow(r)}
                  className={`shrink-0 text-xs rounded-lg px-3 py-1.5 border ${r.checkedInAt != null ? 'border-gray-700 text-gray-400 hover:bg-gray-800' : 'border-green-700 text-green-300 hover:bg-green-950/40'}`}>
                  {r.checkedInAt != null ? 'Deshacer' : event.settings.paymentRequired ? 'Revisar y marcar' : 'Marcar llegada'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {proofOpen && review?.proofUrl && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={() => setProofOpen(false)}
          role="dialog" aria-modal="true" aria-label="Comprobante de pago">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={review.proofUrl} alt={`Comprobante de pago de ${review.name}`} className="max-h-full max-w-full rounded-lg" />
          <button onClick={() => setProofOpen(false)} aria-label="Cerrar" className="absolute top-4 right-4 text-white text-2xl leading-none">✕</button>
        </div>
      )}
    </main>
  );
}
