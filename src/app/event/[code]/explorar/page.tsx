'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables, joinPostedTable, respondToRecommendation, undoTableRejection,
} from '@/lib/firestore';
import WaitingTableInfo, { ActionButton, PostedWho, RecommendedWho } from '@/components/ui/WaitingTableInfo';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import FilterChip from '@/components/ui/FilterChip';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import { tablesToExplore } from '@/lib/explore';
import { isTentative } from '@/lib/registration';
import { runTableGeneration } from '@/lib/tableGeneration';
import type { MeepleEvent, Player, Game, Table } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

/**
 * Tables of games the player wants whose time clashes with a table they already hold — so the system doesn't offer them.
 * Nothing here is automatic: the player looks, and if one is worth more than the table it clashes with they swap, through the
 * same overlap popup as anywhere else. Nobody gets moved by the system.
 */
export default function ExploreTablesPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  // The tables turned down are kept apart behind their own chip, in case they change their mind
  const [showRejected, setShowRejected] = useState(false);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? localStorage.getItem(STORAGE_KEY(code))) as string | null;
    if (!ticketCode) { router.replace('/event/' + code); return; }
    async function load() {
      const [ev, gs, ps] = await Promise.all([getEvent(code), getGames(code), getPlayers(code)]);
      const p = await getPlayerByTicketCode(code, ticketCode!);
      if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); router.replace('/event/' + code); return; }
      setEvent(ev); setPlayer(p); setGames(gs); setPlayers(ps);
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    if (!player) return;
    return subscribeTables(code, setAllTables);
  }, [code, player]);

  const { conflictPrompt, resolveScheduleConflict, handleConflictChoice } = useScheduleConflict(code, player, allTables);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const nameOf = (id: string) => (id === player.id ? 'Vos' : playerMap.get(id)?.name ?? 'alguien');
  const explainerNamesOf = (t: Table) => t.playerIds
    .filter((id) => (playerMap.get(id)?.canExplain ?? []).includes(t.gameId)).map(nameOf);
  const tentative = isTentative(player);

  const allEntries = tablesToExplore({
    playerId: player.id, arrivalTime: player.arrivalTime, departureTime: player.departureTime,
    interests: player.interests, repeatGameIds: player.repeatGameIds ?? [], tables: allTables, games, bufferMinutes: event.settings.bufferMinutes,
  });

  const entries = allEntries.filter((e) => e.rejected === showRejected);
  const openCount = allEntries.filter((e) => !e.rejected).length;
  const rejectedCount = allEntries.length - openCount;

  // Back on the list: no longer remembered as turned down
  async function reconsider(t: Table) {
    if (!player || joiningId) return;
    setJoiningId(t.id);
    try {
      await undoTableRejection(code, t.id, player.id);
    } finally {
      setJoiningId(null);
    }
  }

  // Turns the table down for good: it is remembered as declined, so it leaves this list (and the count on the ticket) and is
  // never offered again
  async function reject(t: Table) {
    if (!player || joiningId) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    setJoiningId(t.id);
    try {
      await respondToRecommendation(code, t.id, player.id, false, game.minPlayers, game.maxPlayers);
    } finally {
      setJoiningId(null);
    }
  }

  // Takes the table in place of the one it clashes with: the overlap popup settles which of theirs they leave
  async function swapIn(t: Table) {
    if (!player || !event || joiningId || isTentative(player)) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    if (!(await resolveScheduleConflict(t))) return;
    setJoiningId(t.id);
    try {
      if (t.postedByOwner) await joinPostedTable(code, t.id, player.id, game.minPlayers, game.maxPlayers);
      else await respondToRecommendation(code, t.id, player.id, true, game.minPlayers, game.maxPlayers);
      runTableGeneration(code, event).catch(() => {});
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">🔎 Explorar mesas</h1>
      </div>
      <p className="text-xs text-gray-500">
        Mesas de juegos que votaste que se pisan con tu agenda, por eso no te las ofrecimos. Antes de cambiarte tené en cuenta que dejás tu
        lugar en la otra mesa: los demás cuentan con vos, y si se queda sin jugadores, o si sos el único que la explica, puede desarmarse.
      </p>
      {tentative && (
        <p className="text-sm text-amber-300 border border-amber-800 bg-amber-950/30 rounded-xl px-3 py-2">
          Estás anotado como indeciso: mandá el comprobante desde tu ticket para poder sumarte a mesas.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <FilterChip active={!showRejected} onClick={() => setShowRejected(false)} label="🔎 Para explorar" count={openCount} activeClass="bg-indigo-500 border-indigo-500 text-white" />
        <FilterChip active={showRejected} onClick={() => setShowRejected(true)} label="❌ Rechazadas" count={rejectedCount} activeClass="bg-gray-200 border-gray-200 text-gray-900" />
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
          {showRejected ? 'No rechazaste ninguna mesa.' : 'Ahora no hay mesas de juegos que votaste que se pisen con tu agenda.'}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(({ table: t, clashes }) => (
            <div key={t.id} className="border border-indigo-800 bg-indigo-950/20 rounded-xl p-3">
              <WaitingTableInfo t={t} game={gameMap.get(t.gameId)} accent="indigo" interested={null} seatWord={t.status === 'confirmed' ? 'jugadores' : 'anotados'}
                onView={() => {}}
                who={t.postedByOwner
                  ? <PostedWho t={t} nameOf={nameOf} explainerNames={explainerNamesOf(t)} />
                  : <RecommendedWho t={t} game={gameMap.get(t.gameId)} nameOf={nameOf} />}
                note={<>⚠️ Se pisa con {clashes.map((c) => `${c.gameName} (${c.startTime}–${c.endTime}${c.status === 'confirmed' ? ', confirmada' : ''})`).join(' y ')}</>} />
              {showRejected ? (
                <div className="mt-3">
                  <ActionButton tone="neutral" onClick={() => reconsider(t)} disabled={joiningId === t.id}>
                    {joiningId === t.id ? 'Un momento...' : '↩️ Volver a considerar'}
                  </ActionButton>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ActionButton tone="neutral" onClick={() => reject(t)} disabled={joiningId === t.id}>❌ Rechazar</ActionButton>
                  <ActionButton tone="indigo" onClick={() => swapIn(t)} disabled={joiningId === t.id || tentative}>
                    {joiningId === t.id ? 'Un momento...' : clashes.length > 1 ? `🔁 Cambiar las ${clashes.length}` : '🔁 Cambiar'}
                  </ActionButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
    </main>
  );
}
