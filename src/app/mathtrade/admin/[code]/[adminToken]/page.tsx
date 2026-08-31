'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  verifyMathTradeAdminToken, getMathTradeEvent, updateMathTradeStatus,
  subscribeMathTradePlayers, subscribeMathTradeItems, saveMathTradeResult, subscribeMathTradeResult,
} from '@/lib/mathtradeFirestore';
import { resolveTrades } from '@/lib/mathTradeAlgorithm';
import type { MathTradeEvent, MathTradePlayer, MathTradeItem, MathTradeResult } from '@/lib/mathtradeTypes';

export default function MathTradeAdminPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [event, setEvent] = useState<MathTradeEvent | null>(null);
  const [players, setPlayers] = useState<MathTradePlayer[]>([]);
  const [items, setItems] = useState<MathTradeItem[]>([]);
  const [result, setResult] = useState<MathTradeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [adminUrl, setAdminUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    verifyMathTradeAdminToken(code, adminToken).then(async (ok) => {
      if (!ok) { setAuthorized(false); return; }
      setAuthorized(true);
      setEvent(await getMathTradeEvent(code));
    });
    const unsubP = subscribeMathTradePlayers(code, setPlayers);
    const unsubI = subscribeMathTradeItems(code, setItems);
    const unsubR = subscribeMathTradeResult(code, setResult);
    return () => { unsubP(); unsubI(); unsubR(); };
  }, [code, adminToken]);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/mathtrade/${code}`);
    setAdminUrl(`${window.location.origin}/mathtrade/admin/${code}/${adminToken}`);
  }, [code, adminToken]);

  async function handleStatusChange(status: MathTradeEvent['status']) {
    await updateMathTradeStatus(code, status);
    setEvent((ev) => ev ? { ...ev, status } : ev);
  }

  async function handleRunAlgorithm() {
    setRunning(true);
    const resolution = resolveTrades(items);
    await saveMathTradeResult(code, resolution);
    await updateMathTradeStatus(code, 'resolved');
    setEvent((ev) => ev ? { ...ev, status: 'resolved' } : ev);
    setRunning(false);
  }

  function copyAdminUrl() {
    navigator.clipboard.writeText(adminUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (authorized === null) return <div className="p-8 text-center">Cargando...</div>;
  if (authorized === false) return <div className="p-8 text-center text-gray-400">Acceso no autorizado.</div>;
  if (!event) return <div className="p-8 text-center">Cargando...</div>;

  const itemById = new Map(items.map((it) => [it.id, it]));
  const itemsByOwner = new Map<string, MathTradeItem[]>();
  for (const item of items) {
    const list = itemsByOwner.get(item.ownerPlayerId) ?? [];
    list.push(item);
    itemsByOwner.set(item.ownerPlayerId, list);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">{event.name} 🔁</h1>
        <p className="text-gray-400 text-sm">Código: {code}</p>
      </div>

      <section className="border border-gray-700 rounded-xl p-5 space-y-2">
        <h2 className="font-semibold">🔑 Tu acceso de administrador</h2>
        <div className="flex items-center gap-2">
          <input readOnly value={adminUrl} className="flex-1 border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-xs" />
          <button onClick={copyAdminUrl} className="border border-gray-700 rounded-lg px-3 py-2 text-sm hover:bg-gray-800 whitespace-nowrap">
            {copied ? '✓' : 'Copiar'}
          </button>
        </div>
        <p className="text-xs text-amber-500">⚠️ Guardá este link — sin él no hay forma de recuperar el acceso.</p>
      </section>

      <section className="border border-gray-700 rounded-xl p-5 space-y-2">
        <h2 className="font-semibold">🔗 Compartir con participantes</h2>
        <input readOnly value={shareUrl} className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-xs" />
      </section>

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="border border-gray-800 rounded-xl py-3">
          <p className="text-2xl font-bold">{players.length}</p>
          <p className="text-xs text-gray-500">Participantes</p>
        </div>
        <div className="border border-gray-800 rounded-xl py-3">
          <p className="text-2xl font-bold">{items.length}</p>
          <p className="text-xs text-gray-500">Items</p>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">Estado del evento</h2>
        <div className="flex gap-2">
          {(['open', 'closed', 'resolved'] as const).map((s) => (
            <button key={s} onClick={() => handleStatusChange(s)}
              className={`px-3 py-1 rounded-lg text-sm border ${
                event.status === s ? 'bg-emerald-600 border-emerald-600' : 'border-gray-700 hover:bg-gray-800'
              }`}>
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <button onClick={handleRunAlgorithm} disabled={running || items.length === 0}
          className="w-full bg-emerald-600 text-white rounded-lg py-3 font-semibold hover:bg-emerald-700 disabled:opacity-50">
          {running ? 'Calculando...' : '⚡ Ejecutar algoritmo de intercambio'}
        </button>

        {result && (
          <div className="border border-emerald-800 bg-emerald-950/30 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold">
              Resultado — {result.cycles.length} loop{result.cycles.length === 1 ? '' : 's'},{' '}
              {result.cycles.reduce((n, c) => n + c.itemIds.length, 0)} items matcheados
            </h3>
            {result.cycles.map((cycle, ci) => (
              <div key={ci} className="text-sm border border-gray-800 rounded-lg p-2">
                <p className="text-xs text-gray-500 mb-1">Loop {ci + 1} ({cycle.itemIds.length} items)</p>
                {cycle.itemIds.map((itemId, i) => {
                  const item = itemById.get(itemId);
                  const received = itemById.get(cycle.itemIds[(i + 1) % cycle.itemIds.length]);
                  if (!item) return null;
                  return (
                    <p key={itemId}>
                      <strong>{item.ownerName}</strong> da <strong>{item.name}</strong> → recibe <strong>{received?.name}</strong>
                    </p>
                  );
                })}
              </div>
            ))}
            {result.unmatchedItemIds.length > 0 && (
              <div className="text-sm">
                <p className="text-gray-400 mb-1">Sin matchear ({result.unmatchedItemIds.length}):</p>
                <p className="text-gray-500">
                  {result.unmatchedItemIds.map((id) => itemById.get(id)?.name).filter(Boolean).join(', ')}
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Participantes e items</h2>
        <div className="space-y-2">
          {players.map((p) => (
            <div key={p.id} className="border border-gray-800 rounded-lg p-3">
              <p className="font-medium text-sm">{p.name}</p>
              <p className="text-xs text-gray-500">
                {(itemsByOwner.get(p.id) ?? []).length === 0
                  ? 'Sin items cargados'
                  : (itemsByOwner.get(p.id) ?? []).map((it) => it.name).join(', ')}
              </p>
            </div>
          ))}
          {players.length === 0 && <p className="text-sm text-gray-500">Todavía no se unió nadie.</p>}
        </div>
      </section>
    </main>
  );
}
