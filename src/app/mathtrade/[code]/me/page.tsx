'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getMathTradeEvent, getMathTradePlayerByTicketCode, subscribeMathTradeItems,
  addMathTradeItem, updateMathTradeItemWantList, subscribeMathTradeResult,
} from '@/lib/mathtradeFirestore';
import type { MathTradeEvent, MathTradePlayer, MathTradeItem, MathTradeResult } from '@/lib/mathtradeTypes';

const STORAGE_KEY = (code: string) => 'mm_mathtrade_ticket_' + code;

type DraftItem = { name: string; description: string; bggUrl: string };

export default function MathTradeTicketPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<MathTradeEvent | null>(null);
  const [player, setPlayer] = useState<MathTradePlayer | null>(null);
  const [items, setItems] = useState<MathTradeItem[]>([]);
  const [result, setResult] = useState<MathTradeResult | null>(null);

  const [newItem, setNewItem] = useState<DraftItem>({ name: '', description: '', bggUrl: '' });
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftWantList, setDraftWantList] = useState<string[]>([]);
  const [savingWantList, setSavingWantList] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? sessionStorage.getItem(STORAGE_KEY(code))) as string | null;
    if (!ticketCode) { router.replace(`/mathtrade/${code}`); return; }
    async function load() {
      const ev = await getMathTradeEvent(code);
      const p = await getMathTradePlayerByTicketCode(code, ticketCode!);
      if (!ev || !p) { router.replace(`/mathtrade/${code}`); return; }
      sessionStorage.setItem(STORAGE_KEY(code), ticketCode!);
      setEvent(ev);
      setPlayer(p);
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    const unsub = subscribeMathTradeItems(code, setItems);
    const unsubR = subscribeMathTradeResult(code, setResult);
    return () => { unsub(); unsubR(); };
  }, [code]);

  async function handleAddItem(e: React.FormEvent) {
    e.preventDefault();
    if (!player || !newItem.name.trim() || addingItem) return;
    setAddingItem(true);
    await addMathTradeItem(code, {
      name: newItem.name.trim(),
      description: newItem.description.trim() || null,
      bggUrl: newItem.bggUrl.trim() || null,
      ownerPlayerId: player.id,
      ownerName: player.name,
      wantList: [],
    });
    setNewItem({ name: '', description: '', bggUrl: '' });
    setAddingItem(false);
  }

  function openWantListEditor(item: MathTradeItem) {
    setEditingItemId(item.id);
    setDraftWantList(item.wantList);
  }

  function toggleWant(itemId: string) {
    setDraftWantList((cur) =>
      cur.includes(itemId) ? cur.filter((id) => id !== itemId) : [...cur, itemId]
    );
  }

  async function saveWantList() {
    if (!editingItemId) return;
    setSavingWantList(true);
    await updateMathTradeItemWantList(code, editingItemId, draftWantList);
    setSavingWantList(false);
    setEditingItemId(null);
  }

  function copyCode() {
    if (!player) return;
    navigator.clipboard.writeText(player.ticketCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading || !event || !player) return <div className="p-8 text-center">Cargando...</div>;

  const myItems = items.filter((it) => it.ownerPlayerId === player.id);
  const otherItems = items.filter((it) => it.ownerPlayerId !== player.id);
  const isResolved = event.status === 'resolved' && result;

  const itemById = new Map(items.map((it) => [it.id, it]));
  const myCycles = isResolved
    ? result!.cycles.filter((c) => c.itemIds.some((id) => itemById.get(id)?.ownerPlayerId === player.id))
    : [];

  return (
    <main className="max-w-lg mx-auto px-4 py-10 space-y-8">
      <div className="text-center">
        <p className="text-gray-400 text-sm mb-1">{event.name}</p>
        <p className="text-3xl font-mono tracking-widest">{player.ticketCode}</p>
        <button onClick={copyCode} className="text-xs text-indigo-400 hover:underline mt-1">
          {copied ? '¡Copiado!' : 'Copiar código'}
        </button>
        <p className="mt-3">Hola, <strong>{player.name}</strong></p>
      </div>

      {isResolved && (
        <section className="border border-emerald-800 bg-emerald-950/30 rounded-xl p-4 space-y-3">
          <h2 className="text-lg font-semibold">🔁 Resultado del trade</h2>
          {myCycles.length === 0 && (
            <p className="text-sm text-gray-400">Ninguno de tus items entró en un loop de intercambio esta vez.</p>
          )}
          {myCycles.map((cycle, ci) => {
            const n = cycle.itemIds.length;
            return cycle.itemIds.map((itemId, i) => {
              const item = itemById.get(itemId);
              if (!item || item.ownerPlayerId !== player.id) return null;
              const receivedId = cycle.itemIds[(i + 1) % n];
              const received = itemById.get(receivedId);
              return (
                <p key={`${ci}-${itemId}`} className="text-sm">
                  Das <strong>{item.name}</strong> y recibís <strong>{received?.name}</strong>
                  {received && <> (de {received.ownerName})</>}
                </p>
              );
            });
          })}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tus items ({myItems.length})</h2>
        {myItems.length === 0 && <p className="text-sm text-gray-500">Todavía no cargaste ningún item.</p>}
        <div className="space-y-2">
          {myItems.map((item) => (
            <div key={item.id} className="border border-gray-700 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-xs text-gray-400">{item.description}</p>}
                  {item.bggUrl && (
                    <a href={item.bggUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:underline">
                      Ver en BGG
                    </a>
                  )}
                </div>
                {!isResolved && (
                  <button onClick={() => openWantListEditor(item)}
                    className="text-xs border border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-800 whitespace-nowrap">
                    Lista de deseos ({item.wantList.length})
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {!isResolved && (
          <form onSubmit={handleAddItem} className="border border-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">Agregar item</p>
            <input
              required
              className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm"
              value={newItem.name}
              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
              placeholder="Nombre del juego"
            />
            <input
              className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm"
              value={newItem.description}
              onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
              placeholder="Descripción / estado (opcional)"
            />
            <input
              type="url"
              className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm"
              value={newItem.bggUrl}
              onChange={(e) => setNewItem({ ...newItem, bggUrl: e.target.value })}
              placeholder="Link BGG (opcional)"
            />
            <button type="submit" disabled={addingItem || !newItem.name.trim()}
              className="w-full bg-emerald-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              {addingItem ? 'Agregando...' : '+ Agregar item'}
            </button>
          </form>
        )}
      </section>

      {editingItemId && (
        <section className="border border-indigo-700 rounded-xl p-4 space-y-3 sticky bottom-4 bg-gray-950">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Ordená tu lista de deseos — hacé click en orden de preferencia</h2>
            <button onClick={() => setEditingItemId(null)} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {otherItems.length === 0 && <p className="text-sm text-gray-500">Todavía no hay items de otros jugadores.</p>}
            {otherItems.map((item) => {
              const rank = draftWantList.indexOf(item.id);
              return (
                <button key={item.id} onClick={() => toggleWant(item.id)}
                  className={`w-full text-left flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm border ${
                    rank >= 0 ? 'border-indigo-500 bg-indigo-950/40' : 'border-gray-800 hover:bg-gray-800'
                  }`}>
                  <span>{item.name} <span className="text-gray-500">· {item.ownerName}</span></span>
                  {rank >= 0 && <span className="text-indigo-400 font-mono">#{rank + 1}</span>}
                </button>
              );
            })}
          </div>
          <button onClick={saveWantList} disabled={savingWantList}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {savingWantList ? 'Guardando...' : '💾 Guardar lista de deseos'}
          </button>
        </section>
      )}

      <Link href="/" className="block text-center text-sm text-gray-500 hover:underline">← Volver al inicio</Link>
    </main>
  );
}
