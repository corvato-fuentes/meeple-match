'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables, joinPostedTable, respondToRecommendation,
} from '@/lib/firestore';
import WaitingTableInfo, { ActionButton, PostedWho, RecommendedWho } from '@/components/ui/WaitingTableInfo';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
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

  const entries = tablesToExplore({
    playerId: player.id, arrivalTime: player.arrivalTime, departureTime: player.departureTime,
    interests: player.interests, repeatGameIds: player.repeatGameIds ?? [], tables: allTables, games, bufferMinutes: event.settings.bufferMinutes,
  });

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
        Mesas de juegos que votaste que se pisan con tu agenda, por eso no te las ofrecimos. Si alguna te gusta más que la mesa con la que se
        pisa, podés cambiarte. Nadie te cambia de mesa por su cuenta.
      </p>
      {tentative && (
        <p className="text-sm text-amber-300 border border-amber-800 bg-amber-950/30 rounded-xl px-3 py-2">
          Estás anotado como indeciso: mandá el comprobante desde tu ticket para poder sumarte a mesas.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
          Ahora no hay mesas de juegos que votaste que se pisen con tu agenda.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(({ table: t, clash }) => (
            <div key={t.id} className="border border-indigo-800 bg-indigo-950/20 rounded-xl p-3">
              <WaitingTableInfo t={t} game={gameMap.get(t.gameId)} accent="indigo" interested={null} seatWord={t.status === 'confirmed' ? 'jugadores' : 'anotados'}
                onView={() => {}}
                who={t.postedByOwner
                  ? <PostedWho t={t} nameOf={nameOf} explainerNames={explainerNamesOf(t)} />
                  : <RecommendedWho t={t} game={gameMap.get(t.gameId)} nameOf={nameOf} />}
                note={<>⚠️ Se pisa con {clash.gameName} ({clash.startTime}–{clash.endTime}{clash.status === 'confirmed' ? ', confirmada' : ''})</>} />
              <div className="mt-3">
                <ActionButton tone="indigo" onClick={() => swapIn(t)} disabled={joiningId === t.id || tentative}>
                  {joiningId === t.id ? 'Cambiando...' : '🔁 Cambiar por esta mesa'}
                </ActionButton>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
    </main>
  );
}
