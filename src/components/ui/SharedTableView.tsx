'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getGames, getPlayerByTicketCode, subscribeTables, joinPostedTable, respondToRecommendation,
} from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import { computeEventStatus } from '@/lib/timeUtils';
import { isShareableTable, pendingTableKey, seatsLine, shareHeadline, shareInfoOf, type ShareInfo } from '@/lib/shareTable';
import type { SharedTablePreview } from '@/lib/shareTableServer';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import GameCover from '@/components/ui/GameCover';
import type { Game, MeepleEvent, Player, Table } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

/**
 * The page a shared table link opens. Someone with a ticket on this device (or sent here by the app with their ticket)
 * sees the table live and can join it right here; anyone else sees what the table is — counts only, no names — and is
 * sent to register or enter their code, then brought back to this table.
 */
export default function SharedTableView({ code, tableId, preview }: { code: string; tableId: string; preview: SharedTablePreview | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<'loading' | 'anon' | 'ready'>('loading');
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState('');

  const { conflictPrompt, resolveScheduleConflict, handleConflictChoice } = useScheduleConflict(code, player, tables ?? []);

  useEffect(() => {
    const ticket = (searchParams.get('ticket') ?? localStorage.getItem(STORAGE_KEY(code))) as string | null;
    (async () => {
      if (!ticket) { setPhase('anon'); return; }
      try {
        const [ev, gs, p] = await Promise.all([getEvent(code), getGames(code), getPlayerByTicketCode(code, ticket)]);
        if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); setPhase('anon'); return; }
        setEvent(ev); setGames(gs); setPlayer(p);
        setPhase('ready');
      } catch {
        setPhase('anon');
      }
    })();
  }, [code, searchParams]);

  useEffect(() => {
    if (!player) return;
    return subscribeTables(code, setTables);
  }, [code, player]);

  function goRegister() {
    try { localStorage.setItem(pendingTableKey(code), tableId); } catch { /* the person can still find the table in the app */ }
    router.push('/event/' + code);
  }

  async function join(t: Table, game: Game) {
    if (!player || !event || joining) return;
    if (!(await resolveScheduleConflict(t))) return; // the overlap popup lets them swap out of a table they hold
    setJoining(true);
    setError('');
    try {
      if (t.postedByOwner) await joinPostedTable(code, t.id, player.id, game.minPlayers, game.maxPlayers);
      else await respondToRecommendation(code, t.id, player.id, true, game.minPlayers, game.maxPlayers);
      runTableGeneration(code, event).catch(() => {});
      setJoined(true);
    } catch {
      setError('No se pudo sumar. Probá de nuevo.');
    } finally {
      setJoining(false);
    }
  }

  if (phase === 'loading') return <div className="p-8 text-center">Cargando...</div>;

  const shell = (children: ReactNode) => (
    <main className="max-w-sm mx-auto px-4 py-12 space-y-4">
      <p className="text-center text-xs text-gray-500">🎲 Meeple Loop{event ? ` · ${event.name}` : preview ? ` · ${preview.eventName}` : ''}</p>
      {children}
    </main>
  );
  const card = (info: ShareInfo, imageUrl: string | null | undefined, endTime: string) => (
    <div className="border border-gray-700 rounded-xl p-4 bg-gray-800 flex gap-3">
      <GameCover size="lg" imageUrl={imageUrl} />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold text-gray-100">{info.gameName}</p>
        <p className="text-xs text-gray-400">🕐 {info.startTime}–{endTime}</p>
        <p className="text-xs text-gray-400">🪑 {seatsLine(info)}</p>
      </div>
    </div>
  );

  // Not signed in on this device: show what the table is and send them to register / enter their code
  if (phase === 'anon' || !player) {
    if (!preview || !preview.open) {
      return shell(
        <>
          <p className="text-center text-sm text-gray-300">Esta mesa ya no está disponible.</p>
          <Link href={`/event/${code}`} className="block text-center border border-gray-700 rounded-xl py-2 text-sm hover:bg-gray-800">Ir al evento</Link>
        </>
      );
    }
    return shell(
      <>
        <h1 className="text-lg font-bold text-center">{shareHeadline(preview)}</h1>
        {card(preview, preview.imageUrl, preview.endTime)}
        <button onClick={goRegister} className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-indigo-700">
          Inscribirme o entrar con mi código
        </button>
        <p className="text-xs text-gray-500 text-center">Cuando termines vas a volver a esta mesa para sumarte.</p>
      </>
    );
  }

  // Signed in
  const ticketHref = `/event/${code}/me?ticket=${player.ticketCode}`;
  const openTablesHref = `/event/${code}/postulated?ticket=${player.ticketCode}`;
  if (event && computeEventStatus(event.date, event.startTime, event.endTime) === 'closed') {
    return shell(<p className="text-center text-sm text-gray-300">Este evento ya terminó.</p>);
  }
  if (tables === null) return <div className="p-8 text-center">Cargando...</div>;
  const t = tables.find((x) => x.id === tableId);
  const game = t ? games.find((g) => g.id === t.gameId) : undefined;
  if (!t || !game || t.status === 'cancelled') {
    return shell(
      <>
        <p className="text-center text-sm text-gray-300">Esta mesa ya no está disponible.</p>
        <Link href={openTablesHref} className="block text-center border border-gray-700 rounded-xl py-2 text-sm hover:bg-gray-800">Ver mesas abiertas</Link>
      </>
    );
  }
  const info = shareInfoOf(t, game);
  const seated = t.playerIds.includes(player.id);
  return shell(
    <>
      <h1 className="text-lg font-bold text-center">{shareHeadline(info)}</h1>
      {card(info, game.imageUrl, t.endTime)}
      {joined || seated ? (
        <>
          <p className="text-center text-sm text-green-400">{joined ? '¡Listo! Te sumaste a esta mesa.' : 'Ya estás en esta mesa.'}</p>
          <Link href={ticketHref} className="block text-center bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-indigo-700">Ir a mi ticket</Link>
        </>
      ) : isShareableTable(t, game) ? (
        <>
          <button onClick={() => join(t, game)} disabled={joining}
            className="w-full bg-indigo-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {joining ? 'Sumando...' : '✅ Sumarme a esta mesa'}
          </button>
          {error && <p className="text-xs text-red-400 text-center">{error}</p>}
          <Link href={ticketHref} className="block text-center text-xs text-gray-500 hover:text-gray-300">Ir a mi ticket</Link>
        </>
      ) : (
        <>
          <p className="text-center text-sm text-gray-300">Esta mesa ya no tiene lugar o ya empezó.</p>
          <Link href={openTablesHref} className="block text-center border border-gray-700 rounded-xl py-2 text-sm hover:bg-gray-800">Ver mesas abiertas</Link>
        </>
      )}
      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
    </>
  );
}
