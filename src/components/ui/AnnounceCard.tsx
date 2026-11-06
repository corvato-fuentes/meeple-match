'use client';
import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { timeAgo } from '@/lib/timeAgo';

const MAX_LENGTH = 200;

interface Recent { id: string; text: string; createdAt: number; sentDevices?: number }
interface Info { devices: number; players: number; recent: Recent[] }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Admin panel: send a message to everyone ("empieza el torneo", "cambió el almuerzo"…). */
export default function AnnounceCard({ code, adminToken }: { code: string; adminToken: string }) {
  const [text, setText] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const infoUrl = `/api/admin/announce?code=${encodeURIComponent(code)}&adminToken=${encodeURIComponent(adminToken)}`;

  // How many devices have notifications on, and the latest announcements. The card still works without them.
  useEffect(() => {
    let cancelled = false;
    fetch(infoUrl).then((res) => (res.ok ? res.json() : null)).then((json) => { if (!cancelled && json) setInfo(json); }).catch(() => {});
    return () => { cancelled = true; };
  }, [infoUrl]);

  async function reload() {
    try {
      const res = await fetch(infoUrl);
      if (res.ok) setInfo(await res.json());
    } catch { /* keep the numbers we had */ }
  }

  async function send() {
    setConfirmOpen(false);
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/announce', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, adminToken, text }),
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; reason?: string; devices?: number; players?: number } | null;
      if (res.ok && json?.ok) {
        setText('');
        setMessage({
          ok: true,
          text: json.devices
            ? `✓ Enviado a ${plural(json.devices, 'dispositivo', 'dispositivos')} (${plural(json.players ?? 0, 'persona', 'personas')}). También aparece en el ticket de todos.`
            : '✓ Publicado en los tickets. Nadie tiene los avisos activados todavía, así que no hubo notificación.',
        });
        void reload();
      } else if (json?.reason === 'too-soon') {
        setMessage({ ok: false, text: 'Esperá unos segundos antes de mandar otro aviso.' });
      } else {
        setMessage({ ok: false, text: 'No se pudo enviar. Intentá de nuevo.' });
      }
    } catch {
      setMessage({ ok: false, text: 'No se pudo enviar. Revisá tu conexión e intentá de nuevo.' });
    } finally {
      setSending(false);
    }
  }

  const trimmed = text.replace(/\s+/g, ' ').trim();
  return (
    <section className="border border-gray-700 rounded-xl p-4 space-y-3">
      <div>
        <h2 className="font-semibold">📣 Avisar a todos</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Llega como notificación a quienes tienen los avisos activados y queda visible en el ticket de todos.
          {info && <> Hoy hay {plural(info.devices, 'dispositivo', 'dispositivos')} ({plural(info.players, 'persona', 'personas')}) con avisos activados.</>}
        </p>
      </div>
      <div>
        <textarea rows={2} maxLength={MAX_LENGTH} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Ej: Arranca el torneo de Catan en la mesa 3 — ¡los esperamos!"
          className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm" />
        <p className="text-xs text-gray-500 text-right">{trimmed.length}/{MAX_LENGTH}</p>
      </div>
      <button onClick={() => setConfirmOpen(true)} disabled={sending || trimmed.length === 0}
        className="w-full bg-amber-600 text-black rounded-lg py-2 text-sm font-semibold hover:bg-amber-500 disabled:opacity-50">
        {sending ? 'Enviando…' : '📣 Enviar a todos'}
      </button>
      {message && <p className={`text-xs ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}

      {info && info.recent.length > 0 && (
        <div className="border-t border-gray-800 pt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-400">Últimos avisos</p>
          {info.recent.map((a) => (
            <div key={a.id} className="text-xs">
              <p className="text-gray-300">{a.text}</p>
              <p className="text-gray-500">
                {timeAgo(a.createdAt)}{a.sentDevices != null && ` · llegó a ${plural(a.sentDevices, 'dispositivo', 'dispositivos')}`}
              </p>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="¿Enviar este aviso a todos?"
        message={`“${trimmed}” — ${
          info && info.devices === 0
            ? 'todavía nadie tiene los avisos activados, así que no llegará como notificación; se muestra en el ticket de todos.'
            : `lo van a recibir ${info ? plural(info.devices, 'dispositivo', 'dispositivos') : 'todos los dispositivos con avisos activados'} y se muestra en el ticket de todos.`
        } No se puede retirar una vez enviado.`}
        confirmLabel="Sí, enviar"
        onConfirm={send}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
