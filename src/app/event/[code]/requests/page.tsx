'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, getGames, getPlayerByTicketCode } from '@/lib/firestore';
import { describeRequesters, requestMatchesGame, type GameRequestView } from '@/lib/gameRequests';
import { isBggUrl, type BggSearchResult } from '@/lib/bgg';
import { useBggSearch } from '@/hooks/useBggSearch';
import GameCover from '@/components/ui/GameCover';
import { ActionButton } from '@/components/ui/WaitingTableInfo';
import type { Game, MeepleEvent, Player } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;
const REFRESH_MS = 20_000;

const REASON_TEXT: Record<string, string> = {
  'too-many-yours': 'Ya tenés 5 pedidos. Quitá alguno para pedir otro juego.',
  'list-full': 'La lista de pedidos de este evento está completa.',
  'already-claimed': 'Alguien acaba de decir que lo lleva.',
  'not-found': 'Ese pedido ya no existe.',
};

/** Games people would like someone to bring: ask for one (found on BGG), say you want it too, or say you will bring it. */
export default function RequestsPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [requests, setRequests] = useState<GameRequestView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<BggSearchResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { bggResults, bggOpen, bggLoading, setBggOpen, setBggResults, skipBggSearchRef } = useBggSearch(selected ? '' : query);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? localStorage.getItem(STORAGE_KEY(code))) as string | null;
    if (!ticketCode) { router.replace('/event/' + code); return; }
    async function load() {
      const [ev, gs] = await Promise.all([getEvent(code), getGames(code)]);
      const p = await getPlayerByTicketCode(code, ticketCode!);
      if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); router.replace('/event/' + code); return; }
      setEvent(ev);
      setPlayer(p);
      setGames(gs);
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  const ticket = player?.ticketCode;
  const refresh = useCallback(async () => {
    if (!ticket) return;
    try {
      const res = await fetch(`/api/requests?code=${encodeURIComponent(code)}&ticket=${encodeURIComponent(ticket)}`);
      if (res.ok) setRequests((await res.json()).requests as GameRequestView[]);
    } catch { /* the next refresh will catch up */ }
  }, [code, ticket]);

  // The list refreshes on its own so people see each other's requests and promises
  useEffect(() => {
    if (!ticket) return;
    const first = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [ticket, refresh]);

  async function send(key: string, body: Record<string, unknown>): Promise<boolean> {
    if (!ticket || busyKey) return false;
    setBusyKey(key);
    setMessage(null);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ticket, ...body }),
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; reason?: string } | null;
      if (!res.ok || !json?.ok) setMessage(REASON_TEXT[json?.reason ?? ''] ?? 'No se pudo guardar. Probá de nuevo.');
      await refresh();
      return !!res.ok && !!json?.ok;
    } catch {
      setMessage('No se pudo guardar. Revisá tu conexión e intentá de nuevo.');
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  function pick(result: BggSearchResult) {
    skipBggSearchRef.current = true;
    setSelected(result);
    setQuery(result.name);
    setBggResults([]);
    setBggOpen(false);
  }

  async function submitRequest(by: { name: string; bggId?: string; year?: string | null; imageUrl?: string | null }) {
    const ok = await send('new', { action: 'request', ...by });
    if (ok) { setSelected(null); setQuery(''); setBggResults([]); }
  }

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const broughtBy = (r: GameRequestView) => games.find((g) => requestMatchesGame(r, g));
  const open = (requests ?? []).filter((r) => !r.claimedBy && !broughtBy(r));
  const covered = (requests ?? []).filter((r) => r.claimedBy || broughtBy(r));
  const typed = query.trim();
  const canTypeIt = !selected && typed.length >= 3 && !bggLoading && bggResults.length === 0;

  const card = (r: GameRequestView) => {
    const already = broughtBy(r);
    return (
      <div key={r.id} className="border border-purple-800 bg-purple-950/20 rounded-xl p-3 space-y-3">
        <div className="flex items-start gap-3 min-w-0">
          <GameCover imageUrl={r.imageUrl} size="ml" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-purple-200">
              {r.name}{r.year && <span className="text-gray-500 font-normal text-sm"> ({r.year})</span>}
            </p>
            <p className="text-sm text-gray-300">🙏 {describeRequesters(r.others, r.iRequested)}</p>
            {isBggUrl(r.bggUrl) && (
              <a href={r.bggUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:underline">Ver en BGG →</a>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {already ? (
            <ActionButton tone="done">✅ Ya lo lleva {already.ownerName || 'alguien'}</ActionButton>
          ) : r.claimedBy ? (
            r.iClaimed ? (
              <>
                <ActionButton tone="done">🎒 Lo llevás vos</ActionButton>
                <ActionButton tone="amber" href={`/event/${code}/me?ticket=${player.ticketCode}`}>➕ Agregarlo a Tus juegos →</ActionButton>
                <ActionButton tone="neutral" onClick={() => send(`unclaim-${r.id}`, { action: 'unclaim', id: r.id })} disabled={busyKey !== null}>Ya no lo llevo</ActionButton>
              </>
            ) : (
              <ActionButton tone="done">🎒 Lo lleva {r.claimedBy}</ActionButton>
            )
          ) : (
            <>
              <ActionButton tone="indigo" onClick={() => send(`claim-${r.id}`, { action: 'claim', id: r.id })} disabled={busyKey !== null}>
                🎒 Yo lo llevo
              </ActionButton>
              {r.iRequested ? (
                <ActionButton tone="neutral" onClick={() => send(`unrequest-${r.id}`, { action: 'unrequest', id: r.id })} disabled={busyKey !== null}>
                  ✓ Lo pediste · quitar mi pedido
                </ActionButton>
              ) : (
                <ActionButton tone="amber" onClick={() => send(`request-${r.id}`, { action: 'request', name: r.name, bggId: r.bggId ?? undefined, year: r.year, imageUrl: r.imageUrl })} disabled={busyKey !== null}>
                  🙋 A mí también me gustaría jugarlo
                </ActionButton>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">🙏 Juegos pedidos</h1>
      </div>
      <p className="text-sm text-gray-400">
        ¿Hay un juego que te gustaría jugar en el evento y nadie lo lleva? Pedilo acá: quien lo tenga puede decir que lo lleva.
      </p>

      <section className="border border-gray-700 rounded-xl p-3 space-y-3">
        <div className="relative">
          <input value={query} type="search" placeholder="🔍 Buscá el juego en BGG (ej. Dune Imperium)" aria-label="Buscar juego en BGG"
            onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
            onFocus={() => { if (bggResults.length > 0) setBggOpen(true); }}
            onBlur={() => setTimeout(() => setBggOpen(false), 150)}
            className="w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-sm" />
          {bggOpen && bggResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {bggResults.map((r) => (
                <button key={r.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-800 flex items-center gap-2">
                  <GameCover imageUrl={r.imageUrl} size="sm" />
                  <span className="truncate flex-1">{r.name}</span>
                  {r.year && <span className="text-gray-500 text-xs shrink-0">{r.year}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {bggLoading && <p className="text-xs text-gray-500">Buscando en BGG...</p>}
        {selected && (
          <ActionButton tone="amber" onClick={() => submitRequest({ name: selected.name, bggId: selected.id, year: selected.year, imageUrl: selected.imageUrl })} disabled={busyKey !== null}>
            {busyKey === 'new' ? 'Pidiendo...' : `🙏 Pedir que alguien lleve ${selected.name}`}
          </ActionButton>
        )}
        {canTypeIt && (
          <ActionButton tone="neutral" onClick={() => submitRequest({ name: typed })} disabled={busyKey !== null}>
            No lo encuentro: pedir «{typed}» tal cual
          </ActionButton>
        )}
        {message && <p className="text-xs text-amber-300" role="status">{message}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-gray-200">🙏 Se buscan ({open.length})</h2>
        {requests === null ? (
          <p className="text-sm text-gray-500 text-center py-4">Cargando…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">Todavía no hay pedidos. ¡Buscá un juego y pedilo!</p>
        ) : (
          <div className="space-y-3">{open.map(card)}</div>
        )}
      </section>

      {covered.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-gray-200">🎒 Ya hay quien lo lleve ({covered.length})</h2>
          <div className="space-y-3">{covered.map(card)}</div>
        </section>
      )}
    </main>
  );
}
