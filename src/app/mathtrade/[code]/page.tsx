'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getMathTradeEvent, addMathTradePlayer, generateUniqueMathTradeTicketCode,
} from '@/lib/mathtradeFirestore';
import type { MathTradeEvent } from '@/lib/mathtradeTypes';

const STORAGE_KEY = (code: string) => 'mm_mathtrade_ticket_' + code;

export default function MathTradeJoinPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<MathTradeEvent | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticketInput, setTicketInput] = useState('');

  useEffect(() => {
    const existing = sessionStorage.getItem(STORAGE_KEY(code));
    if (existing) { router.replace(`/mathtrade/${code}/me?ticket=${existing}`); return; }
    getMathTradeEvent(code).then((ev) => { setEvent(ev); setLoading(false); });
  }, [code, router]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    const ticketCode = await generateUniqueMathTradeTicketCode(code);
    await addMathTradePlayer(code, { name: name.trim(), ticketCode });
    sessionStorage.setItem(STORAGE_KEY(code), ticketCode);
    router.push(`/mathtrade/${code}/me?ticket=${ticketCode}`);
  }

  function handleReaccess(e: React.FormEvent) {
    e.preventDefault();
    const t = ticketInput.trim().toUpperCase();
    if (t) router.push(`/mathtrade/${code}/me?ticket=${t}`);
  }

  if (loading) return <div className="p-8 text-center">Cargando...</div>;

  if (!event) return (
    <div className="p-8 text-center text-gray-400 space-y-4">
      <p>No encontramos este math trade.</p>
      <Link href="/" className="inline-block text-indigo-400 hover:underline text-sm">← Volver al inicio</Link>
    </div>
  );

  return (
    <main className="max-w-sm mx-auto px-4 py-12 space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-1">{event.name}</h1>
        <p className="text-gray-400 text-sm">Código: {code}</p>
      </div>

      <form onSubmit={handleJoin} className="space-y-3 border border-gray-700 rounded-xl p-5">
        <h2 className="font-semibold">Unirme al math trade</h2>
        <input
          required
          className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tu nombre"
        />
        <button type="submit" disabled={submitting || !name.trim()}
          className="w-full bg-emerald-600 text-white rounded-lg py-2 font-semibold hover:bg-emerald-700 disabled:opacity-50">
          {submitting ? 'Uniendo...' : 'Unirme →'}
        </button>
      </form>

      <form onSubmit={handleReaccess} className="space-y-3 border border-gray-800 rounded-xl p-5">
        <h2 className="font-semibold text-sm text-gray-400">Ya me uní — tengo mi código</h2>
        <input
          className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-center tracking-widest uppercase font-mono"
          value={ticketInput}
          onChange={(e) => setTicketInput(e.target.value)}
          placeholder="CÓDIGO"
          maxLength={6}
        />
        <button type="submit" disabled={!ticketInput.trim()}
          className="w-full border border-gray-700 rounded-lg py-2 font-medium hover:bg-gray-800 disabled:opacity-50">
          Ver mis items →
        </button>
      </form>
    </main>
  );
}
