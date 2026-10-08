'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables, getPlayerTables,
  joinPostedTable, leavePostedTable,
} from '@/lib/firestore';
import { estimatedDuration } from '@/lib/tableAlgorithm';
import { toMinutes } from '@/lib/timeUtils';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import ConfirmModal from '@/components/ui/ConfirmModal';
import type { MeepleEvent, Player, Game, Table, GameComplexity } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

const COMPLEXITY_LABEL: Record<GameComplexity, string> = { light: 'Liviano', medium: 'Intermedio', heavy: 'Pesado' };

export default function PostulatedTablesPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [otherPlayers, setOtherPlayers] = useState<Player[]>([]);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [myTables, setMyTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningTableId, setJoiningTableId] = useState<string | null>(null);
  const [leavingTable, setLeavingTable] = useState<Table | null>(null);
  const [viewingTableId, setViewingTableId] = useState<string | null>(null);
  const [leavingTableId, setLeavingTableId] = useState<string | null>(null);

  useEffect(() => {
    const ticketCode = (searchParams.get('ticket') ?? localStorage.getItem(STORAGE_KEY(code))) as string | null;
    if (!ticketCode) { router.replace('/event/' + code); return; }
    async function load() {
      const [ev, gs, ps] = await Promise.all([getEvent(code), getGames(code), getPlayers(code)]);
      const p = await getPlayerByTicketCode(code, ticketCode!);
      if (!p || !ev) { localStorage.removeItem(STORAGE_KEY(code)); router.replace('/event/' + code); return; }
      setEvent(ev);
      setPlayer(p);
      setGames(gs);
      setOtherPlayers(ps);
      setLoading(false);
    }
    load();
  }, [code, router, searchParams]);

  useEffect(() => {
    if (!player) return;
    const unsub = subscribeTables(code, (ts) => { setAllTables(ts); setMyTables(getPlayerTables(player.id, ts)); });
    return unsub;
  }, [code, player]);

  const { conflictPrompt, resolveScheduleConflict, handleConflictChoice } = useScheduleConflict(code, player, allTables);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const otherPlayerMap = new Map(otherPlayers.map((p) => [p.id, p]));
  const myId = player.id;

  // Until the table is confirmed, show the full worst-case estimate (everyone seated, e.g. ~135min);
  // once confirmed it shrinks to the real roster and updates if someone else joins.
  function gameMetaLine(gameId: string, t: Table): string | null {
    const game = gameMap.get(gameId);
    if (!game) return null;
    const players = t.status === 'confirmed' ? Math.max(t.playerIds.length, game.minPlayers) : game.maxPlayers;
    return `${COMPLEXITY_LABEL[game.complexity]} · ~${estimatedDuration(game, players)}min`;
  }

  const nameOf = (id: string) => (id === myId ? 'Vos' : otherPlayerMap.get(id)?.name ?? 'alguien');

  // "Trae" is whoever posted the table with their own copy; explainers are the seated players who
  // know how to teach this game — they can differ, and a table can have no explainer yet.
  const whoLines = (t: Table) => {
    const explainers = t.playerIds.filter((id) => otherPlayerMap.get(id)?.canExplain.includes(t.gameId)).map(nameOf);
    return (
      <div className="mt-1 space-y-0.5">
        <p className="text-xs text-gray-400">📦 Trae: <span className="text-gray-300">{nameOf(t.explainerId)}</span></p>
        <p className="text-xs text-gray-400">🎓 Explica: <span className="text-gray-300">{explainers.length > 0 ? explainers.join(', ') : 'nadie todavía'}</span></p>
      </div>
    );
  };

  // Two different numbers: the minimum that confirms the table, and the free seats up to the
  // game's maximum. Every person who joins uses up one free seat.
  const seatLines = (t: Table) => {
    const game = gameMap.get(t.gameId);
    const seated = t.playerIds.length;
    const missing = game ? Math.max(0, game.minPlayers - seated) : null;
    const free = game ? Math.max(0, game.maxPlayers - seated) : null;
    return (
      <>
        <p className="text-xs text-gray-400">
          👥 {seated} anotado{seated === 1 ? '' : 's'}
          {missing != null && (missing > 0 ? ` · faltan ${missing} para confirmar` : ' · ya se confirma')}
        </p>
        {free != null && game && (
          <p className="text-xs text-gray-400">🪑 {free} lugar{free === 1 ? '' : 'es'} libre{free === 1 ? '' : 's'} de {game.maxPlayers}</p>
        )}
      </>
    );
  };

  const coverFor = (gameId: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={gameMap.get(gameId)?.imageUrl || '/cover-placeholder.png'} alt=""
      className="w-9 h-11 rounded object-cover border border-gray-700 bg-gray-900 shrink-0" />
  );

  // The poster can't leave their own table (they bring the game) — for them it means cancelling it.
  const leaveBtn = (t: Table) => (
    <button onClick={() => setLeavingTable(t)} disabled={leavingTableId === t.id}
      className="mt-2 w-full text-xs border border-gray-700 text-gray-400 rounded-lg px-2.5 py-1.5 font-medium hover:bg-gray-800 disabled:opacity-50">
      {leavingTableId === t.id ? 'Saliendo...' : t.explainerId === myId ? '🚫 Cancelar mesa' : '🚪 Salirme de la mesa'}
    </button>
  );

  const viewBtn = (t: Table) => (
    <button onClick={() => setViewingTableId(t.id)} className="text-xs text-purple-300 hover:underline shrink-0">
      👀 Ver inscriptos
    </button>
  );

  // A player is free for a window if it fits their own arrival/departure and doesn't overlap
  // (with buffer) any table they're already seated at or explaining.
  function isPlayerFreeFor(start: string, end: string): boolean {
    if (!event) return false;
    const buf = event.settings.bufferMinutes;
    const sMin = toMinutes(start);
    const eMin = toMinutes(end);
    if (sMin < toMinutes(player!.arrivalTime) + buf || eMin > toMinutes(player!.departureTime)) return false;
    return myTables.every((t) => toMinutes(t.endTime) + buf <= sMin || eMin + buf <= toMinutes(t.startTime));
  }

  async function handleLeaveTable() {
    const t = leavingTable;
    setLeavingTable(null);
    if (!t || !player || leavingTableId) return;
    setLeavingTableId(t.id);
    try {
      await leavePostedTable(code, t.id, player.id, gameMap.get(t.gameId)?.minPlayers ?? 1);
    } finally {
      setLeavingTableId(null);
    }
  }

  async function handleJoinOpenTable(t: Table) {
    if (!player || joiningTableId) return;
    const game = games.find((g) => g.id === t.gameId);
    if (!game) return;
    if (!(await resolveScheduleConflict(t))) return;
    setJoiningTableId(t.id);
    try {
      await joinPostedTable(code, t.id, player.id, game.minPlayers, game.maxPlayers);
    } finally {
      setJoiningTableId(null);
    }
  }

  // Ones I posted myself — still waiting to fill up.
  const myOwnPostulatedTables = allTables
    .filter((t) => t.status === 'recommended' && t.postedByOwner && t.explainerId === player.id)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Ones someone else posted that I already joined — still waiting to fill up.
  const myJoinedPostulatedTables = allTables
    .filter((t) =>
      t.status === 'recommended' && t.postedByOwner &&
      t.playerIds.includes(player.id) && t.explainerId !== player.id
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const joinableTables = allTables
    .filter((t) =>
      t.postedByOwner && t.status === 'recommended' &&
      !t.playerIds.includes(player.id) && t.explainerId !== player.id &&
      t.playerIds.length < (gameMap.get(t.gameId)?.maxPlayers ?? 0) &&
      isPlayerFreeFor(t.startTime, t.endTime)
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Postulated tables (mine or joined) that already hit the minimum and got confirmed — also
  // shown on the main ticket page, but useful here too to see the whole postulated flow through.
  const myConfirmedPostulatedTables = allTables
    .filter((t) =>
      t.postedByOwner && ['confirmed', 'in-progress'].includes(t.status) &&
      (t.playerIds.includes(player.id) || t.explainerId === player.id)
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <main className="max-w-6xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">📣 Mesas postuladas</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
        <section>
          <h2 className="font-semibold text-gray-200 mb-2">📌 Las que armaste vos</h2>
          {myOwnPostulatedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía no postulaste ninguna mesa. Proponé una desde “Tus juegos”.
            </p>
          ) : (
            <div className="space-y-2">
              {myOwnPostulatedTables.map((t) => {
                return (
                  <div key={t.id} className="border border-purple-800 bg-purple-950/20 rounded-xl px-3 py-2">
                    <div className="flex justify-between items-start">
                      <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm">{t.gameName}</span></span>
                      <span className="text-xs text-purple-400 shrink-0">{t.startTime}–{t.endTime}</span>
                    </div>
                    {gameMetaLine(t.gameId, t) && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId, t)}</p>
                    )}
                    {whoLines(t)}
                    <div className="space-y-0.5 mt-1">
                      {seatLines(t)}
                      {viewBtn(t)}
                    </div>
                    {leaveBtn(t)}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">🎉 Abiertas para sumarte</h2>
          <p className="text-xs text-gray-500 mb-2">Las que ofrecen otros jugadores — sumate con un toque.</p>
          {joinableTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              No hay ninguna abierta para sumarte todavía.
            </p>
          ) : (
            <div className="space-y-2">
              {joinableTables.map((t) => {
                return (
                  <div key={t.id} className="border border-indigo-800 bg-indigo-950/20 rounded-xl px-3 py-2">
                    <div className="flex justify-between items-start gap-2">
                      <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm">{t.gameName}</span></span>
                      <span className="text-xs text-indigo-300 shrink-0">{t.startTime}–{t.endTime}</span>
                    </div>
                    {gameMetaLine(t.gameId, t) && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId, t)}</p>
                    )}
                    {whoLines(t)}
                    <div className="space-y-0.5">
                      {seatLines(t)}
                      {viewBtn(t)}
                    </div>
                    <button onClick={() => handleJoinOpenTable(t)} disabled={joiningTableId === t.id}
                      className="mt-2 w-full text-xs bg-indigo-600 rounded-lg px-2.5 py-1.5 font-medium hover:bg-indigo-700 disabled:opacity-50">
                      {joiningTableId === t.id ? 'Sumando...' : '+ Sumarme'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">🙋 Te anotaste</h2>
          <p className="text-xs text-gray-500 mb-2">Mesas de otros jugadores a las que ya te sumaste, esperando que se llenen.</p>
          {myJoinedPostulatedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía no te sumaste a ninguna mesa postulada.
            </p>
          ) : (
            <div className="space-y-2">
              {myJoinedPostulatedTables.map((t) => {
                return (
                  <div key={t.id} className="border border-purple-800 bg-purple-950/20 rounded-xl px-3 py-2">
                    <div className="flex justify-between items-start">
                      <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm">{t.gameName}</span></span>
                      <span className="text-xs text-purple-400 shrink-0">{t.startTime}–{t.endTime}</span>
                    </div>
                    {gameMetaLine(t.gameId, t) && (
                      <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId, t)}</p>
                    )}
                    {whoLines(t)}
                    <div className="space-y-0.5">
                      {seatLines(t)}
                      {viewBtn(t)}
                    </div>
                    {leaveBtn(t)}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-semibold text-gray-200 mb-2">✅ Confirmadas</h2>
          <p className="text-xs text-gray-500 mb-2">Ya llegaron al mínimo — también las vas a ver en la pantalla principal.</p>
          {myConfirmedPostulatedTables.length === 0 ? (
            <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">
              Todavía ninguna mesa postulada se confirmó.
            </p>
          ) : (
            <div className="space-y-2">
              {myConfirmedPostulatedTables.map((t) => (
                <div key={t.id} className="border border-green-800 bg-green-950/10 rounded-xl px-3 py-2">
                  <div className="flex justify-between items-start">
                    <span className="flex items-center gap-2 min-w-0">{coverFor(t.gameId)}<span className="font-medium text-sm">{t.gameName}</span></span>
                    <span className="text-xs text-green-400 shrink-0">{t.startTime}–{t.endTime}</span>
                  </div>
                  {gameMetaLine(t.gameId, t) && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{gameMetaLine(t.gameId, t)}</p>
                  )}
                  {whoLines(t)}
                  <div className="space-y-0.5 mt-1">
                    <p className="text-xs text-gray-400">✅ {t.playerIds.length} jugadores</p>
                    {viewBtn(t)}
                  </div>
                  {leaveBtn(t)}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
      {viewingTableId && (() => {
        const t = allTables.find((x) => x.id === viewingTableId);
        if (!t) return null;
        const game = gameMap.get(t.gameId);
        const close = () => setViewingTableId(null);
        const names = t.playerIds.map((id) => (id === myId ? 'Vos' : otherPlayerMap.get(id)?.name ?? '?'));
        const missing = game ? Math.max(0, game.minPlayers - t.playerIds.length) : null;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
            <div className="max-w-sm w-full max-h-[80vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
              onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className="font-semibold text-gray-100">{t.gameName}</h3>
                <p className="text-xs text-gray-500">{t.startTime}–{t.endTime}</p>
              </div>
              {whoLines(t)}
              <div>
                <p className="text-xs font-semibold text-gray-300 mb-1">✅ Anotados ({names.length})</p>
                <ul className="text-xs text-gray-400 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {names.map((n, i) => <li key={i} className="truncate">{n}</li>)}
                </ul>
              </div>
              {missing != null && t.status === 'recommended' && (
                <p className="text-xs text-gray-500">
                  {missing > 0 ? `Faltan ${missing} para llegar al mínimo y confirmarse.` : 'Ya llegó al mínimo.'}
                </p>
              )}
              <button onClick={close} className="w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800">
                Cerrar
              </button>
            </div>
          </div>
        );
      })()}
      <ConfirmModal
        open={!!leavingTable}
        title={leavingTable?.explainerId === myId ? '¿Cancelar esta mesa?' : '¿Salirte de esta mesa?'}
        message={!leavingTable ? '' : leavingTable.explainerId === myId
          ? `Vas a cancelar tu mesa de ${leavingTable.gameName} (${leavingTable.startTime}–${leavingTable.endTime}). Los jugadores anotados la van a dejar de ver.`
          : leavingTable.status === 'confirmed'
            ? `Vas a dejar tu lugar en ${leavingTable.gameName} (${leavingTable.startTime}–${leavingTable.endTime}), que ya está confirmada. Si queda por debajo del mínimo vuelve a esperar jugadores.`
            : `Vas a dejar tu lugar en ${leavingTable.gameName} (${leavingTable.startTime}–${leavingTable.endTime}). Si querés, después podés volver a sumarte mientras haya lugar.`}
        confirmLabel={leavingTable?.explainerId === myId ? 'Sí, cancelar' : 'Sí, salirme'}
        danger
        onConfirm={handleLeaveTable}
        onCancel={() => setLeavingTable(null)}
      />
    </main>
  );
}
