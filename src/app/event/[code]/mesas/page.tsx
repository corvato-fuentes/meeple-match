'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, getPlayerByTicketCode, getGames, getPlayers, subscribeTables, respondToRecommendation, joinPostedTable, joinConfirmedTable,
  leaveTable, leavePostedTable, undoTableRejection, moveOwnerTable, updatePlayerWishlist,
} from '@/lib/firestore';
import { ActionButton, PostedWho, RecommendedWho } from '@/components/ui/WaitingTableInfo';
import ExploreCard from '@/components/ui/ExploreCard';
import ExplainerOffer from '@/components/ui/ExplainerOffer';
import ConflictPromptModal from '@/components/ui/ConflictPromptModal';
import ConfirmModal from '@/components/ui/ConfirmModal';
import LeaveTableConfirm from '@/components/ui/LeaveTableConfirm';
import OtherOffersPrompt from '@/components/ui/OtherOffersPrompt';
import ShareTableButton from '@/components/ui/ShareTableButton';
import MoveTableSuggestion from '@/components/ui/MoveTableSuggestion';
import FilterChip from '@/components/ui/FilterChip';
import PushOptIn from '@/components/ui/PushOptIn';
import { useScheduleConflict } from '@/hooks/useScheduleConflict';
import {
  EXPLORE_CHIPS, chipCounts, chipsFor, clashesOf, exploreRows, rowsFor, type ExploreChip, type ExploreRow,
} from '@/lib/exploreTables';
import { liveAvailability } from '@/lib/liveBoard';
import { blockedMessage } from '@/lib/freeSeats';
import { splitConflicts } from '@/lib/scheduleConflicts';
import { explainEndFor } from '@/lib/explainOnly';
import { otherOffersForGame } from '@/lib/offers';
import { interestedInTable } from '@/lib/tableAlgorithm';
import { confirmedPlayers, isTentative } from '@/lib/registration';
import { runTableGeneration } from '@/lib/tableGeneration';
import { isShareableTable } from '@/lib/shareTable';
import { minSeats } from '@/lib/seats';
import { slotMapFor } from '@/lib/physicalSlots';
import { toMinutes } from '@/lib/timeUtils';
import { BOARD_RETURN_KEY } from '@/lib/boardReturn';
import type { MeepleEvent, Player, Game, Table } from '@/lib/types';

const STORAGE_KEY = (code: string) => 'mm_ticket_' + code;

const CHIP_STYLE: Record<ExploreChip, string> = {
  'for-you': 'bg-amber-600 border-amber-600 text-black',
  all: 'bg-gray-200 border-gray-200 text-gray-900',
  mine: 'bg-indigo-500 border-indigo-500 text-white',
  recommended: 'bg-amber-600 border-amber-600 text-black',
  posted: 'bg-purple-500 border-purple-500 text-white',
  confirmed: 'bg-green-600 border-green-600 text-black',
  playing: 'bg-emerald-500 border-emerald-500 text-black',
  free: 'bg-emerald-600 border-emerald-600 text-white',
  rejected: 'bg-gray-500 border-gray-500 text-white',
  done: 'bg-gray-500 border-gray-500 text-white',
};
const CHIP_HINT: Record<ExploreChip, string> = {
  'for-you': 'Lo que espera tu respuesta: las mesas que te proponemos y las abiertas de juegos que votaste.',
  all: 'Todas las mesas del evento por horario, sin las que rechazaste ni las que ya terminaron.',
  mine: 'Las mesas donde estás anotado o donde explicás.',
  recommended: 'Las que arma el sistema con los votos de todos.',
  posted: 'Las que armó un jugador con su propio juego, abiertas para sumarse.',
  confirmed: 'Ya llegaron al mínimo: se van a jugar.',
  playing: 'Se están jugando ahora.',
  free: 'Tienen lugar y todavía no empezaron.',
  rejected: 'Las mesas que rechazaste. Si cambiaste de idea, podés volver a considerarlas.',
  done: 'Las que ya se jugaron.',
};
const CHIP_EMPTY: Record<ExploreChip, string> = {
  'for-you': 'No hay nada esperando tu respuesta. Cuando tus votos coincidan con un horario en común, va a aparecer acá.',
  all: 'Todavía no hay mesas. Votá juegos para que se armen.',
  mine: 'Todavía no estás en ninguna mesa.',
  recommended: 'No hay mesas recomendadas.',
  posted: 'No hay mesas postuladas. Si traés un juego, podés proponer una desde «Tus juegos».',
  confirmed: 'Todavía ninguna mesa se confirmó.',
  playing: 'No hay mesas en curso.',
  free: 'Ninguna mesa tiene lugar ahora.',
  rejected: 'No rechazaste ninguna mesa.',
  done: 'Todavía no terminó ninguna mesa.',
};

const isChip = (v: string | null): v is ExploreChip => EXPLORE_CHIPS.some((c) => c.key === v);

/**
 * "Explorar mesas": every table of the event in one place, as the person sees it — the ones offered to them, the open ones, the ones
 * they are in, the ones being played. It opens on what is waiting for them; the filters keep every state in sight with its count.
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
  const [chip, setChip] = useState<ExploreChip | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [leavingTable, setLeavingTable] = useState<Table | null>(null);
  const [viewing, setViewing] = useState<{ tableId: string; kind: 'confirmed' | 'interested' } | null>(null);
  // Other tables of the same game the person was also offered, asked about right after they take one
  const [otherOffers, setOtherOffers] = useState<Table[]>([]);
  const answeredOffers = useRef(new Set<string>());
  const [repeatPromptGameId, setRepeatPromptGameId] = useState<string | null>(null);
  // Set once the person accepts a table: that's the moment to offer notifications about it
  const [acceptedOne, setAcceptedOne] = useState(false);
  // The table whose Aceptar opened the overlap popup (so its "Rechazar" knows which table to decline)
  const [acceptingTable, setAcceptingTable] = useState<Table | null>(null);
  // The game the person just said "no me interesa" to: its tables are gone from the list, and they can take it back
  const [dismissed, setDismissed] = useState<{ gameId: string; name: string } | null>(null);

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

  // The clock decides which tables have started (and take no more people)
  useEffect(() => {
    queueMicrotask(() => setNow(new Date()));
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { conflictPrompt, resolveScheduleConflict, handleConflictChoice } = useScheduleConflict(code, player, allTables);

  if (loading || !now) return <div className="p-8 text-center">Cargando...</div>;
  if (!player || !event) return null;

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const myId = player.id;
  const tentative = isTentative(player);
  const buffer = event.settings.bufferMinutes;
  // The physical table of the schedule: only the tables that are set have one
  const slotByTableId = slotMapFor(allTables.filter((t) => t.status !== 'recommended'), buffer);
  const nameOf = (id: string) => (id === myId ? 'Vos' : playerMap.get(id)?.name ?? 'alguien');
  const explainerNamesOf = (t: Table) => t.playerIds
    .filter((id) => (id === myId ? player.canExplain : playerMap.get(id)?.canExplain ?? []).includes(t.gameId)).map(nameOf);

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const started = (t: Table) => event.date < todayStr || (event.date === todayStr && nowMin >= toMinutes(t.startTime));

  const rows = exploreRows({ viewer: player, tables: allTables, games, bufferMinutes: buffer, started });
  const counts = chipCounts(rows);
  // Opens on what is waiting for them, whatever it holds; the address can ask for another one (the old links land here)
  const eventHasStarted = liveAvailability(event.date, todayStr) !== 'before';
  const chips = chipsFor(eventHasStarted);
  const urlChip = searchParams.get('filtro');
  const wanted: ExploreChip = chip ?? (isChip(urlChip) ? urlChip : 'for-you');
  // A filter that isn't shown yet (an old address asking for "En curso" before the event) falls back to what is waiting for them
  const active: ExploreChip = chips.some((c) => c.key === wanted) ? wanted : 'for-you';
  const visible = rowsFor(rows, active);

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────────────
  // Accept/reject for an algorithm-recommended table. On accept, if they were also offered ANOTHER table of the same game, ask about
  // that one right away; only when there is none, and they haven't opted into a repeat for this game yet, ask in general whether
  // they'd join a second table of it. `onlyExplain`: the explainer takes no seat and is held just for the explanation.
  async function respond(t: Table, accept: boolean, fromPrompt = false, onlyExplain = false) {
    if (!player || busyId) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    const onlyUntil = accept && onlyExplain ? explainEndFor(t, game) : undefined;
    if (accept) {
      setAcceptingTable(t);
      const ok = await resolveScheduleConflict(t, onlyUntil ? { start: t.startTime, end: onlyUntil } : undefined);
      setAcceptingTable(null);
      if (!ok) return;
    }
    setBusyId(t.id);
    try {
      await respondToRecommendation(code, t.id, player.id, accept, game.minPlayers, game.maxPlayers, onlyUntil);
      if (accept && event) runTableGeneration(code, event).catch(() => {});
      if (accept) {
        setAcceptedOne(true);
        answeredOffers.current.add(t.id);
        const others = otherOffersForGame(allTables, player.id, t.gameId, t.id, (id) => gameMap.get(id)).filter((o) => !answeredOffers.current.has(o.id));
        if (others.length > 0) setOtherOffers(others);
        else if (!fromPrompt && !onlyExplain && !(player.repeatGameIds ?? []).includes(t.gameId)) setRepeatPromptGameId(t.gameId);
      }
    } finally {
      setBusyId(null);
    }
  }

  // Takes a table somebody posted (their own explicit act), asking first what to do with a table of theirs it clashes with
  async function joinPosted(t: Table) {
    if (!player || !event || busyId || isTentative(player)) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    if (!(await resolveScheduleConflict(t))) return;
    setBusyId(t.id);
    try {
      await joinPostedTable(code, t.id, player.id, game.minPlayers, game.maxPlayers);
      runTableGeneration(code, event).catch(() => {});
      answeredOffers.current.add(t.id);
      setOtherOffers(otherOffersForGame(allTables, myId, t.gameId, t.id, (id) => gameMap.get(id)).filter((o) => !answeredOffers.current.has(o.id)));
    } finally {
      setBusyId(null);
    }
  }

  // A free place at a confirmed table: also their own act, and the last place can be gone by the time they tap
  async function joinConfirmed(t: Table) {
    if (!player || !event || busyId || isTentative(player)) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    if (!(await resolveScheduleConflict(t))) return;
    setBusyId(t.id);
    try {
      const joined = await joinConfirmedTable(code, t.id, player.id, game.maxPlayers);
      if (joined) runTableGeneration(code, event).catch(() => {});
      else window.alert('Esa mesa se llenó justo ahora.');
    } finally {
      setBusyId(null);
    }
  }

  // Turns the table down: it is remembered as declined, never offered again, and kept under "Rechazadas"
  async function reject(t: Table) {
    if (!player || busyId) return;
    const game = gameMap.get(t.gameId);
    if (!game) return;
    setBusyId(t.id);
    try {
      await respondToRecommendation(code, t.id, player.id, false, game.minPlayers, game.maxPlayers);
    } finally {
      setBusyId(null);
    }
  }

  async function reconsider(t: Table) {
    if (!player || busyId) return;
    setBusyId(t.id);
    try {
      await undoTableRejection(code, t.id, player.id);
    } finally {
      setBusyId(null);
    }
  }

  // "Bajarme de la mesa": a table already accepted (or confirmed) can be given up too. For the owner of a posted table it cancels it.
  async function leave() {
    const t = leavingTable;
    setLeavingTable(null);
    if (!t || !player || busyId) return;
    setBusyId(t.id);
    try {
      if (t.postedByOwner) await leavePostedTable(code, t.id, player.id, gameMap.get(t.gameId)?.minPlayers ?? 1);
      else {
        await leaveTable(code, t, player.id, gameMap.get(t.gameId)?.minPlayers ?? 1);
        if (event) runTableGeneration(code, event).catch(() => {});
      }
    } finally {
      setBusyId(null);
    }
  }

  // The owner moves their table to a time that suits more of the people who voted it; the ones in it are asked again
  async function moveMyTable(t: Table, startTime: string, endTime: string) {
    if (!player || !event) return;
    await moveOwnerTable(code, t.id, player.id, startTime, endTime);
    runTableGeneration(code, event).catch(() => {});
  }

  async function answerOtherOffer(t: Table, accept: boolean) {
    answeredOffers.current.add(t.id);
    setOtherOffers((q) => q.filter((o) => o.id !== t.id));
    if (t.postedByOwner) { if (accept) await joinPosted(t); else await reject(t); }
    else await respond(t, accept, true);
  }

  // "No me interesa este juego": the vote is saved and every table of that game leaves the list (see exploreRows)
  async function setGameInterest(gameId: string, name: string, level: 'no' | null) {
    if (!player) return;
    const interests = { ...player.interests };
    if (level) interests[gameId] = level; else delete interests[gameId];
    const before = player;
    setPlayer({ ...player, interests });
    setDismissed(level ? { gameId, name } : null);
    try {
      await updatePlayerWishlist(code, player.id, {
        interests, canExplain: player.canExplain, playedGameIds: player.playedGameIds ?? [], repeatGameIds: player.repeatGameIds ?? [],
      });
    } catch {
      setPlayer(before);
      setDismissed(null);
      window.alert('No se pudo guardar tu voto. Probá de nuevo.');
    }
  }

  // "Rechazar" inside the overlap popup: closes it (cancelling the accept) and declines that table
  async function rejectFromConflictPopup() {
    const t = acceptingTable;
    await handleConflictChoice(false);
    if (t) await respond(t, false);
  }

  async function handleRepeatChoice(gameId: string, wantsRepeat: boolean) {
    setRepeatPromptGameId(null);
    if (!player || !wantsRepeat) return;
    const nextRepeat = [...(player.repeatGameIds ?? []), gameId];
    setPlayer({ ...player, repeatGameIds: nextRepeat });
    await updatePlayerWishlist(code, player.id, {
      interests: player.interests, canExplain: player.canExplain, playedGameIds: player.playedGameIds ?? [], repeatGameIds: nextRepeat,
    });
  }

  // ── A table ───────────────────────────────────────────────────────────────────────────────────────────
  const interestedCount = (t: Table, posted: boolean): number | null => {
    if (t.status !== 'recommended') return null;
    if (posted) return interestedInTable(t, confirmedPlayers(players), allTables, buffer).length;
    return [...(t.candidateIds ?? []), ...(t.queuedIds ?? [])].filter((id) => !t.playerIds.includes(id)).length;
  };

  // What taking this table would do to the tables of theirs it clashes with
  function clashNote(r: ExploreRow) {
    const clashes = clashesOf(r.table, player!, allTables, buffer);
    if (clashes.length === 0) return null;
    const { loud, quiet } = splitConflicts(clashes);
    const explainsQuiet = quiet.some((c) => c.explainerId === myId);
    const describe = (cs: Table[]) => cs.map((c) => `${c.gameName} (${c.startTime}–${c.endTime}${c.status === 'confirmed' ? ', confirmada' : ''})`).join(' y ');
    return loud.length > 0
      ? <>⚠️ Se pisa con {describe(loud)}{quiet.length > 0 && <>. Además aceptaste {describe(quiet)}, que todavía no se confirmó{explainsQuiet && ' (la explicás vos: pasa a otro explicador, o queda esperando uno)'}</>}</>
      : <>ℹ️ Aceptaste {describe(quiet)}, que todavía no se confirmó: si aceptás esta, salís de {quiet.length > 1 ? 'esas' : 'esa'}.{explainsQuiet && ' La explicás vos: pasa a otro explicador, o queda esperando uno.'}</>;
  }

  function actionsFor(r: ExploreRow) {
    const t = r.table;
    const game = r.game;
    const busy = busyId === t.id;
    const posted = !!t.postedByOwner;
    const own = posted && t.explainerId === myId;
    const asExplainer = !!t.awaitingExplainer && (t.candidateIds ?? []).includes(myId) && r.offered;

    if (r.rejected) {
      return <ActionButton tone='neutral' onClick={() => reconsider(t)} disabled={busy}>{busy ? 'Un momento...' : '↩️ Volver a considerar'}</ActionButton>;
    }
    if (r.step === 'done') return null;
    if (r.mine) {
      return (
        <>
          {r.step === 'playing'
            ? <ActionButton tone='done'>▶️ Mesa en curso</ActionButton>
            : <ActionButton tone='neutral' onClick={() => setLeavingTable(t)} disabled={busy}>
                {busy ? 'Saliendo...' : own ? '🚫 Cancelar mesa' : posted ? '🚪 Salirme de la mesa' : '🚪 Bajarme de la mesa'}
              </ActionButton>}
          {own && r.step === 'forming' && (
            <MoveTableSuggestion table={t} poster={player!} players={confirmedPlayers(players)} allTables={allTables} games={games} event={event!}
              onMove={(start, end) => moveMyTable(t, start, end)} />
          )}
        </>
      );
    }
    if (asExplainer) {
      return <>
        <ExplainerOffer table={t} game={game} disabled={busy} saving={busy} onAnswer={(accept, only) => respond(t, accept, false, only)} />
      </>;
    }
    // Offered to them (by the system, or a posted table of a game they voted that fits): answer, like any other offer
    if (r.offered || r.openForYou) {
      const tone = posted ? 'indigo' : 'amber';
      return <>
        <div className='grid grid-cols-2 gap-2'>
          <ActionButton tone='neutral' onClick={() => reject(t)} disabled={busy || tentative}>❌ Rechazar</ActionButton>
          <ActionButton tone={tone} onClick={() => (posted ? joinPosted(t) : respond(t, true))} disabled={busy || tentative}>
            {busy ? 'Un momento...' : '✅ Aceptar'}
          </ActionButton>
        </div>
      </>;
    }
    const o = r.option;
    if (!o) return null;
    if (o.kind === 'join') {
      return <ActionButton tone='indigo' onClick={() => (posted ? joinPosted(t) : joinConfirmed(t))} disabled={busy || tentative}>{busy ? 'Un momento...' : '+ Sumarme'}</ActionButton>;
    }
    if (o.kind === 'vote') {
      return <ActionButton tone='indigo' onClick={() => router.push(`/event/${code}/games?ticket=${player!.ticketCode}`)}>👍 Votar este juego para que te la ofrezcan</ActionButton>;
    }
    if (o.kind === 'blocked' && o.reason.kind !== 'in-table') return <ActionButton tone='muted'>ℹ️ {blockedMessage(o.reason, t)}</ActionButton>;
    return null;
  }

  // In the detail of the card: sharing the table, and — for a game they never voted — putting it aside
  function extrasFor(r: ExploreRow): ReactNode {
    const t = r.table;
    const share = r.game && isShareableTable(t, r.game) && (r.mine || r.offered)
      ? <ShareTableButton code={code} table={t} game={r.game} event={event!} /> : null;
    const canDismiss = !!r.game && player!.interests?.[t.gameId] == null && !r.mine && !r.rejected && r.step !== 'done';
    if (!share && !canDismiss) return null;
    return (
      <>
        {share}
        {canDismiss && (
          <button onClick={() => setGameInterest(t.gameId, t.gameName, 'no')}
            className="w-full text-xs text-gray-400 hover:text-gray-200 border border-gray-800 rounded-lg py-1.5 hover:bg-gray-800">
            👎 No me interesa este juego
          </button>
        )}
      </>
    );
  }

  function card(r: ExploreRow) {
    const t = r.table;
    const posted = !!t.postedByOwner;
    const actionable = !r.mine && !r.rejected && r.step !== 'done' && r.step !== 'playing' && (r.offered || r.openForYou || r.option?.kind === 'join');
    const note = r.offered && t.awaitingExplainer && (t.candidateIds ?? []).includes(myId)
      ? '🎓 Podés explicar este juego — elegí si además jugás o solo lo explicás; recién ahí se les ofrece a los demás'
      : actionable ? clashNote(r) : undefined;
    return (
      <ExploreCard key={t.id} row={r} game={r.game} slot={slotByTableId.get(t.id) ?? null} nameOf={nameOf} viewerId={myId}
        who={posted ? <PostedWho t={t} nameOf={nameOf} explainerNames={explainerNamesOf(t)} /> : <RecommendedWho t={t} game={r.game} nameOf={nameOf} />}
        interested={interestedCount(t, posted)} onView={(kind) => setViewing({ tableId: t.id, kind })}
        note={note} actions={actionsFor(r)} extras={extrasFor(r)} />
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/event/${code}/me?ticket=${player.ticketCode}`} className="text-gray-500 hover:text-gray-300">←</Link>
          <h1 className="text-xl font-bold truncate">🎲 Explorar mesas</h1>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href={`/event/${code}/games?ticket=${player.ticketCode}`}
            className="text-xs border border-gray-700 rounded-xl px-2.5 py-1.5 text-gray-300 hover:bg-gray-800">👍 Votar juegos</Link>
          <Link href={`/event/${code}/board?ticket=${player.ticketCode}`}
            onClick={() => sessionStorage.setItem(BOARD_RETURN_KEY(code), `/event/${code}/mesas?ticket=${player.ticketCode}`)}
            className="text-xs border border-gray-700 rounded-xl px-2.5 py-1.5 text-gray-300 hover:bg-gray-800">📺 Grilla</Link>
        </div>
      </div>

      {acceptedOne && <PushOptIn code={code} ticketCode={player.ticketCode} variant="prompt" />}

      {dismissed && (
        <div role="status" className="flex items-start justify-between gap-3 text-sm border border-gray-700 bg-gray-800/60 text-gray-200 rounded-xl px-3 py-2">
          <p>👎 Listo: ya no te mostramos las mesas de <strong>{dismissed.name}</strong>. Si cambiás de idea, lo encontrás en «Juegos de todos» → Ocultados.</p>
          <button onClick={() => setGameInterest(dismissed.gameId, dismissed.name, null)} className="shrink-0 text-indigo-300 hover:underline">Deshacer</button>
        </div>
      )}

      {tentative && (
        <p className="text-sm text-amber-300 border border-amber-800 bg-amber-950/30 rounded-xl px-3 py-2">
          Estás anotado como indeciso: mandá el comprobante desde tu ticket para poder sumarte a mesas.
        </p>
      )}

      <section>
        <div className="flex flex-wrap gap-2 mb-2">
          {chips.map((c) => {
            // The counter turns into a flag when that filter holds something waiting for them
            const hot = c.key === 'for-you' || c.key === 'recommended' || c.key === 'posted'
              ? rowsFor(rows, c.key).filter((r) => r.chips.has('for-you')).length : 0;
            return (
              <FilterChip key={c.key} active={active === c.key} onClick={() => setChip(c.key)} label={c.label} count={counts[c.key]}
                activeClass={CHIP_STYLE[c.key]} highlightClass={hot > 0 ? 'bg-amber-500 text-black' : undefined} />
            );
          })}
        </div>
        <p className="text-xs text-gray-500 mb-3">{CHIP_HINT[active]}</p>
        {visible.length === 0
          ? <p className="text-sm text-gray-500 bg-gray-900 rounded-xl p-4 text-center">{CHIP_EMPTY[active]}</p>
          : <div className="space-y-2">{visible.map(card)}</div>}
      </section>

      {viewing && (() => {
        const t = allTables.find((x) => x.id === viewing.tableId);
        if (!t) return null;
        const game = gameMap.get(t.gameId);
        const close = () => setViewing(null);
        const posted = !!t.postedByOwner;
        const names = viewing.kind === 'interested'
          ? (posted
              ? interestedInTable(t, confirmedPlayers(players), allTables, buffer).map((r) => nameOf(r.player.id) + (r.busy ? ' · ocupado' : ''))
              : [...(t.candidateIds ?? []), ...(t.queuedIds ?? [])].filter((id) => !t.playerIds.includes(id)).map(nameOf))
          : t.playerIds.map(nameOf);
        const missing = game ? Math.max(0, minSeats(game) - t.playerIds.length) : null;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={close}>
            <div className="max-w-sm w-full max-h-[80vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
              <div>
                <h3 className="font-semibold text-gray-100">{t.gameName}</h3>
                <p className="text-xs text-gray-500">{t.startTime}–{t.endTime}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-300 mb-1">{viewing.kind === 'interested' ? '🤔 Interesados (sin confirmar)' : t.status === 'recommended' ? '✅ Anotados' : '🪑 En la mesa'} ({names.length})</p>
                {names.length === 0
                  ? <p className="text-xs text-gray-500">{viewing.kind === 'interested' ? 'No quedan interesados pendientes.' : 'Nadie todavía.'}</p>
                  : <ul className="text-xs text-gray-400 grid grid-cols-2 gap-x-3 gap-y-0.5">{names.map((n, i) => <li key={i} className="truncate">{n}</li>)}</ul>}
              </div>
              {missing != null && t.status === 'recommended' && (
                <p className="text-xs text-gray-500">{missing > 0 ? `Faltan ${missing} para llegar al mínimo y confirmarse.` : 'Ya llegó al mínimo.'}</p>
              )}
              <button onClick={close} className="w-full border border-gray-700 rounded-lg py-2 text-xs text-gray-400 hover:bg-gray-800">Cerrar</button>
            </div>
          </div>
        );
      })()}

      <OtherOffersPrompt offers={otherOffers} busy={busyId !== null}
        onAccept={(t) => answerOtherOffer(t, true)} onReject={(t) => answerOtherOffer(t, false)} onLater={() => setOtherOffers([])} />

      {repeatPromptGameId && (() => {
        const game = gameMap.get(repeatPromptGameId);
        if (!game) return null;
        return (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => handleRepeatChoice(game.id, false)}>
            <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold text-gray-100">¿Te gustaría sumarte también a una segunda mesa de {game.name} si se llega a armar otra?</h3>
              <div className="flex gap-2">
                <button onClick={() => handleRepeatChoice(game.id, false)} className="flex-1 border border-gray-700 rounded-lg py-2 text-xs font-medium text-gray-400 hover:bg-gray-800">No, con esta alcanza</button>
                <button onClick={() => handleRepeatChoice(game.id, true)} className="flex-1 bg-indigo-600 rounded-lg py-2 text-xs font-medium hover:bg-indigo-700">Sí, sumame también</button>
              </div>
            </div>
          </div>
        );
      })()}

      {leavingTable && !leavingTable.postedByOwner && <LeaveTableConfirm table={leavingTable} myId={myId} onConfirm={leave} onCancel={() => setLeavingTable(null)} />}
      <ConfirmModal
        open={!!leavingTable && !!leavingTable.postedByOwner}
        title={leavingTable?.explainerId === myId ? '¿Cancelar esta mesa?' : '¿Salirte de esta mesa?'}
        message={!leavingTable ? '' : leavingTable.explainerId === myId
          ? `Vas a cancelar tu mesa de ${leavingTable.gameName} (${leavingTable.startTime}–${leavingTable.endTime}). Los jugadores anotados la van a dejar de ver.`
          : leavingTable.status === 'confirmed'
            ? `Vas a dejar tu lugar en ${leavingTable.gameName} (${leavingTable.startTime}–${leavingTable.endTime}), que ya está confirmada. Si queda por debajo del mínimo vuelve a esperar jugadores.`
            : `Vas a dejar tu lugar en ${leavingTable.gameName} (${leavingTable.startTime}–${leavingTable.endTime}). Si querés, después podés volver a sumarte mientras haya lugar.`}
        confirmLabel={leavingTable?.explainerId === myId ? 'Sí, cancelar' : 'Sí, salirme'}
        danger
        onConfirm={leave}
        onCancel={() => setLeavingTable(null)}
      />
      <ConflictPromptModal prompt={conflictPrompt} onChoice={handleConflictChoice} onReject={rejectFromConflictPopup} />
    </main>
  );
}
