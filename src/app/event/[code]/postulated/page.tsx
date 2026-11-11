'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables, getPlayerTables,
  joinPostedTable, leavePostedTable, respondToRecommendation,
} from '@/lib/firestore';
import WaitingTableInfo, { ActionButton, PostedWho } from '@/components/ui/WaitingTableInfo';
import { toMinutes } from '@/lib/timeUtils';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import ConfirmModal from '@/components/ui/ConfirmModal';
import FilterChip from '@/components/ui/FilterChip';
import OtherOffersPrompt from '@/components/ui/OtherOffersPrompt';
import ShareTableButton from '@/components/ui/ShareTableButton';
import { isShareableTable } from '@/lib/shareTable';
import { otherOffersForGame } from '@/lib/offers';
import { interestedInTable } from '@/lib/tableAlgorithm';
import { runTableGeneration } from '@/lib/tableGeneration';
import { minSeats } from '@/lib/seats';
import type { MeepleEvent, Player, Game, Table } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;


type TableFilter = 'open' | 'joined' | 'own' | 'confirmed' | 'all';

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
  const [viewing, setViewing] = useState<{ tableId: string; kind: 'confirmed' | 'interested' } | null>(null);
  // Other tables of the same game the player was also offered, asked about right after they join one
  const [otherOffers, setOtherOffers] = useState<Table[]>([]);
  const answeredOffers = useRef(new Set<string>());
  const [leavingTableId, setLeavingTableId] = useState<string | null>(null);
  // null = nothing picked yet, so the list opens on "Abiertas" when there is something to join
  const [tableFilter, setTableFilter] = useState<TableFilter | null>(null);

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

  // Somebody who voted a posted table's game and fits it should have been offered it. If the offers haven't been written
  // (the table was posted before the votes, or a pass was skipped) run the generation pass once, so they get the offer
  // and its notification. Once offered they stop counting here, so this doesn't repeat.
  const healedOnce = useRef(false);
  useEffect(() => {
    if (healedOnce.current || !event || otherPlayers.length === 0 || allTables.length === 0) return;
    const unoffered = allTables.some((t) => t.postedByOwner && t.status === 'recommended' &&
      interestedInTable(t, otherPlayers, allTables, event.settings.bufferMinutes)
        .some((r) => !r.busy && !(t.candidateIds ?? []).includes(r.player.id) && !(t.queuedIds ?? []).includes(r.player.id)));
    if (!unoffered) return;
    healedOnce.current = true;
    runTableGeneration(code, event).catch(() => {});
  }, [code, event, otherPlayers, allTables]);

  if (loading) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const otherPlayerMap = new Map(otherPlayers.map((p) => [p.id, p]));
  const myId = player.id;

  const nameOf = (id: string) => (id === myId ? 'Vos' : otherPlayerMap.get(id)?.name ?? 'alguien');

  // The poster brings the game; the explainers are whoever is seated and knows how to teach it (there may be none yet).
  const explainerNamesOf = (t: Table) => t.playerIds
    .filter((id) => (id === myId ? player.canExplain : otherPlayerMap.get(id)?.canExplain ?? []).includes(t.gameId))
    .map(nameOf);

  // The poster can't leave their own table (they bring the game) — for them it means cancelling it.
  const leaveBtn = (t: Table) => (
    <ActionButton tone="neutral" onClick={() => setLeavingTable(t)} disabled={leavingTableId === t.id}>
      {leavingTableId === t.id ? 'Saliendo...' : t.explainerId === myId ? '🚫 Cancelar mesa' : '🚪 Salirme de la mesa'}
    </ActionButton>
  );

  // Why a window doesn't work for this player — null when it fits. It has to sit inside their own
  // arrival/departure and not overlap (with buffer) any table they're already seated at or explaining.
  // Saying the reason (instead of silently hiding the table) lets them fix it — e.g. leave the other
  // table or move their arrival time.
  function unavailableReason(start: string, end: string): string | null {
    if (!event) return 'No se pudo comprobar tu horario';
    const buf = event.settings.bufferMinutes;
    const sMin = toMinutes(start);
    const eMin = toMinutes(end);
    const arrival = toMinutes(player!.arrivalTime);
    if (sMin < arrival) return `Empieza antes de que llegues (llegás a las ${player!.arrivalTime})`;
    if (sMin < arrival + buf) return `Arranca muy pegada a tu llegada (llegás a las ${player!.arrivalTime})`;
    if (eMin > toMinutes(player!.departureTime)) return `Termina después de que te vayas (te vas a las ${player!.departureTime})`;
    const clash = myTables.find((t) => !(toMinutes(t.endTime) + buf <= sMin || eMin + buf <= toMinutes(t.startTime)));
    if (clash) {
      // Overlapping outright vs. just not leaving the buffer minutes between two tables
      const overlaps = !(toMinutes(clash.endTime) <= sMin || eMin <= toMinutes(clash.startTime));
      return `${overlaps ? 'Se pisa con' : 'No deja margen con'} ${clash.gameName} (${clash.startTime}–${clash.endTime})`;
    }
    return null;
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
      askAboutOtherOffers(t);
    } finally {
      setJoiningTableId(null);
    }
  }

  // After taking a table: any other table of the same game they were offered is asked about right away
  function askAboutOtherOffers(taken: Table) {
    answeredOffers.current.add(taken.id);
    setOtherOffers(otherOffersForGame(allTables, myId, taken.gameId, taken.id, (id) => gameMap.get(id)).filter((o) => !answeredOffers.current.has(o.id)));
  }

  // "Rechazar" on an offer: that table stops being offered to them (they can still join it later with "Sumarme")
  async function handleRejectTable(t: Table) {
    if (!player || joiningTableId) return;
    const game = games.find((g) => g.id === t.gameId);
    if (!game) return;
    setJoiningTableId(t.id);
    try {
      await respondToRecommendation(code, t.id, player.id, false, game.minPlayers, game.maxPlayers);
    } finally {
      setJoiningTableId(null);
    }
  }

  async function answerOtherOffer(t: Table, accept: boolean) {
    answeredOffers.current.add(t.id);
    setOtherOffers((q) => q.filter((o) => o.id !== t.id));
    if (accept) await handleJoinOpenTable(t); else await handleRejectTable(t);
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

  // Open tables from others that still have a seat. The ones that don't fit my schedule stay in the
  // list, dimmed and with the reason, instead of vanishing.
  const openTablesWithSeats = allTables
    .filter((t) =>
      t.postedByOwner && t.status === 'recommended' &&
      !t.playerIds.includes(player.id) && t.explainerId !== player.id &&
      t.playerIds.length < (gameMap.get(t.gameId)?.maxPlayers ?? 0)
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const blockedReason = new Map<string, string>();
  for (const t of openTablesWithSeats) {
    const why = unavailableReason(t.startTime, t.endTime);
    if (why) blockedReason.set(t.id, why);
  }
  const joinableTables = openTablesWithSeats.filter((t) => !blockedReason.has(t.id));
  const blockedTables = openTablesWithSeats.filter((t) => blockedReason.has(t.id));
  // Of the ones that fit, the ones for a game the player voted 👍 are the ones meant "for them" (the same count the
  // ticket page announces); the rest are still shown, just after those, since they might like them too.
  const forYouTables = joinableTables.filter((t) => player.interests[t.gameId] === 'yes' && !(t.rejectedIds ?? []).includes(myId));
  const forYouIds = new Set(forYouTables.map((t) => t.id));
  type OpenGroup = 'forYou' | 'others' | 'blocked';
  const openGroupOf = (t: Table): OpenGroup => (blockedReason.has(t.id) ? 'blocked' : forYouIds.has(t.id) ? 'forYou' : 'others');
  const OPEN_GROUP_TITLE: Record<OpenGroup, string> = {
    forYou: `👍 Para vos — de juegos que votaste (${forYouTables.length})`,
    others: `Otras abiertas que te quedan libres (${joinableTables.length - forYouTables.length})`,
    blocked: `No te quedan libres (${blockedTables.length})`,
  };

  // Postulated tables (mine or joined) that already hit the minimum and got confirmed — also
  // shown on the main ticket page, but useful here too to see the whole postulated flow through.
  const myConfirmedPostulatedTables = allTables
    .filter((t) =>
      t.postedByOwner && ['confirmed', 'in-progress'].includes(t.status) &&
      (t.playerIds.includes(player.id) || t.explainerId === player.id)
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // One list with filter chips instead of four columns: a table keeps its place when it changes
  // state (only its badge changes) and the whole day reads in time order under "Todas".
  type TableKind = 'open' | 'blocked' | 'joined' | 'own' | 'confirmed';
  const tableEntries: { t: Table; kind: TableKind }[] = [
    ...joinableTables.map((t) => ({ t, kind: 'open' as const })),
    ...blockedTables.map((t) => ({ t, kind: 'blocked' as const })),
    ...myJoinedPostulatedTables.map((t) => ({ t, kind: 'joined' as const })),
    ...myOwnPostulatedTables.map((t) => ({ t, kind: 'own' as const })),
    ...myConfirmedPostulatedTables.map((t) => ({ t, kind: 'confirmed' as const })),
  ].sort((a, b) => a.t.startTime.localeCompare(b.t.startTime));
  // Opens on what you can still join; falls back to everything when nothing is open.
  const activeTableFilter: TableFilter = tableFilter ?? (joinableTables.length > 0 ? 'open' : 'all');
  // "Abiertas" lists the ones meant for you first, then the other ones that fit, then the ones that don't (each in time order).
  const OPEN_GROUP_ORDER: OpenGroup[] = ['forYou', 'others', 'blocked'];
  const visibleEntries = activeTableFilter === 'open'
    ? OPEN_GROUP_ORDER.flatMap((g) => tableEntries.filter((e) => (e.kind === 'open' || e.kind === 'blocked') && openGroupOf(e.t) === g))
    : tableEntries.filter((e) => activeTableFilter === 'all' || e.kind === activeTableFilter);

  const TABLE_FILTER_HINT: Record<TableFilter, string> = {
    open: 'Las que ofrecen otros jugadores — sumate con un toque. Primero las de juegos que votaste, después las otras que te quedan libres, y al final las que no (con el motivo).',
    joined: 'Mesas de otros jugadores a las que ya te sumaste, esperando que se llenen.',
    own: 'Las mesas que postulaste vos, esperando que se sumen jugadores.',
    confirmed: 'Ya llegaron al mínimo — también las vas a ver en la pantalla principal.',
    all: 'Todas tus mesas postuladas y las abiertas, ordenadas por horario.',
  };
  const TABLE_FILTER_EMPTY: Record<TableFilter, string> = {
    open: 'No hay ninguna abierta para sumarte todavía.',
    joined: 'Todavía no te sumaste a ninguna mesa postulada.',
    own: 'Todavía no postulaste ninguna mesa. Proponé una desde “Tus juegos”.',
    confirmed: 'Todavía ninguna mesa postulada se confirmó.',
    all: 'Todavía no hay mesas postuladas para vos.',
  };
  const KIND_BADGE: Record<TableKind, { label: string; cls: string }> = {
    open: { label: '🎉 Abierta', cls: 'bg-indigo-900/60 text-indigo-300' },
    blocked: { label: '🚫 No te queda libre', cls: 'bg-gray-800 text-gray-400' },
    joined: { label: '🙋 Te anotaste', cls: 'bg-purple-900/60 text-purple-300' },
    own: { label: '📌 La armaste vos', cls: 'bg-purple-900/60 text-purple-300' },
    confirmed: { label: '✅ Confirmada', cls: 'bg-green-900/60 text-green-300' },
  };

  // People interested in the table who aren't in it: offered it, or voted its game and the slot fits them
  const interestedRows = (t: Table) => interestedInTable(t, otherPlayers, allTables, event.settings.bufferMinutes);
  const interestedIn = (t: Table) => interestedRows(t).length;

  const tableCard = (t: Table, kind: TableKind) => {
    const border = kind === 'open' ? 'border-indigo-800 bg-indigo-950/20'
      : kind === 'blocked' ? 'border-gray-700 bg-gray-900/40 opacity-70'
      : kind === 'confirmed' ? 'border-green-800 bg-green-950/10' : 'border-purple-800 bg-purple-950/20';
    const accent = kind === 'open' ? 'indigo' : kind === 'blocked' ? 'gray' : kind === 'confirmed' ? 'green' : 'purple';
    return (
      <div key={t.id} className={`border rounded-xl p-3 ${border}`}>
        <WaitingTableInfo t={t} game={gameMap.get(t.gameId)} accent={accent} interested={interestedIn(t)}
          seatWord={kind === 'confirmed' ? 'jugadores' : 'anotados'} onView={(k) => setViewing({ tableId: t.id, kind: k })}
          who={<PostedWho t={t} nameOf={nameOf} explainerNames={explainerNamesOf(t)} />}
          badge={<span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_BADGE[kind].cls}`}>
            {kind === 'open' && forYouIds.has(t.id) ? '👍 De un juego que votaste' : KIND_BADGE[kind].label}
          </span>} />
        <div className="mt-3">
          {kind === 'blocked' ? (
            <ActionButton tone="warn">⛔ {blockedReason.get(t.id)}</ActionButton>
          ) : kind === 'open' && forYouIds.has(t.id) ? (
            // Offered to them because they voted the game and the slot fits: answer, like any other offer
            <div className="grid grid-cols-2 gap-2">
              <ActionButton tone="neutral" onClick={() => handleRejectTable(t)} disabled={joiningTableId === t.id}>❌ Rechazar</ActionButton>
              <ActionButton tone="indigo" onClick={() => handleJoinOpenTable(t)} disabled={joiningTableId === t.id}>
                {joiningTableId === t.id ? 'Sumando...' : '✅ Aceptar'}
              </ActionButton>
            </div>
          ) : kind === 'open' ? (
            <ActionButton tone="indigo" onClick={() => handleJoinOpenTable(t)} disabled={joiningTableId === t.id}>
              {joiningTableId === t.id ? 'Sumando...' : '+ Sumarme'}
            </ActionButton>
          ) : leaveBtn(t)}
        </div>
        {isShareableTable(t, gameMap.get(t.gameId)) && (
          <div className="mt-2"><ShareTableButton code={code} table={t} game={gameMap.get(t.gameId)!} event={event} /></div>
        )}
      </div>
    );
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
        <h1 className="text-xl font-bold">📣 Mesas postuladas</h1>
      </div>

      <section>
        <div className="flex flex-wrap gap-2 mb-2">
          <FilterChip active={activeTableFilter === 'open'} onClick={() => setTableFilter('open')} label="🎉 Abiertas"
            count={joinableTables.length} activeClass="bg-indigo-500 border-indigo-500 text-white" highlightClass="bg-purple-400 text-black" />
          <FilterChip active={activeTableFilter === 'joined'} onClick={() => setTableFilter('joined')} label="🙋 Te anotaste"
            count={myJoinedPostulatedTables.length} activeClass="bg-purple-500 border-purple-500 text-white" />
          <FilterChip active={activeTableFilter === 'own'} onClick={() => setTableFilter('own')} label="📌 Las tuyas"
            count={myOwnPostulatedTables.length} activeClass="bg-purple-500 border-purple-500 text-white" />
          <FilterChip active={activeTableFilter === 'confirmed'} onClick={() => setTableFilter('confirmed')} label="✅ Confirmadas"
            count={myConfirmedPostulatedTables.length} activeClass="bg-green-600 border-green-600 text-black" />
          <FilterChip active={activeTableFilter === 'all'} onClick={() => setTableFilter('all')} label="Todas"
            count={tableEntries.length} activeClass="bg-gray-200 border-gray-200 text-gray-900" />
        </div>
        <p className="text-xs text-gray-500 mb-3">{TABLE_FILTER_HINT[activeTableFilter]}</p>
        {visibleEntries.length === 0 ? (
          <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">{TABLE_FILTER_EMPTY[activeTableFilter]}</p>
        ) : (
          <div className="space-y-2">
            {visibleEntries.map((e, i) => (
              <div key={e.t.id}>
                {activeTableFilter === 'open' && (i === 0 || openGroupOf(visibleEntries[i - 1].t) !== openGroupOf(e.t)) && (
                  <p className={`text-xs font-semibold mb-2 ${i === 0 ? '' : 'mt-3'} ${openGroupOf(e.t) === 'forYou' ? 'text-purple-300' : 'text-gray-400'}`}>
                    {OPEN_GROUP_TITLE[openGroupOf(e.t)]}
                  </p>
                )}
                {tableCard(e.t, e.kind)}
              </div>
            ))}
          </div>
        )}
      </section>

      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} />
      <OtherOffersPrompt offers={otherOffers} busy={joiningTableId !== null}
        onAccept={(t) => answerOtherOffer(t, true)} onReject={(t) => answerOtherOffer(t, false)} onLater={() => setOtherOffers([])} />
      {viewing && (() => {
        const t = allTables.find((x) => x.id === viewing.tableId);
        if (!t) return null;
        const game = gameMap.get(t.gameId);
        const close = () => setViewing(null);
        const nameList = (ids: string[]) => ids.map((id) => (id === myId ? 'Vos' : otherPlayerMap.get(id)?.name ?? '?'));
        const names = viewing.kind === 'interested'
          ? interestedRows(t).map((r) => nameList([r.player.id])[0] + (r.busy ? ' · ocupado' : ''))
          : nameList(t.playerIds);
        const missing = game ? Math.max(0, minSeats(game) - t.playerIds.length) : null;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
            <div className="max-w-sm w-full max-h-[80vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
              onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className="font-semibold text-gray-100">{t.gameName}</h3>
                <p className="text-xs text-gray-500">{t.startTime}–{t.endTime}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-300 mb-1">{viewing.kind === 'interested' ? '🤔 Interesados' : '✅ Anotados'} ({names.length})</p>
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
