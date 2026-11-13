'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribeTables, updateTableStatus, updateTable, setTableEnd, dissolveTable, getPlayers, getGames } from '@/lib/firestore';
import { toMinutes } from '@/lib/timeUtils';
import { assignPhysicalSlots } from '@/lib/physicalSlots';
import Time24Input from '@/components/ui/Time24Input';
import { sameGameOverlaps, expectedTableEnd } from '@/lib/tableAlgorithm';
import { nextExplainer } from '@/lib/explainer';
import type { MeepleEvent, Table, Player, Game } from '@/lib/types';

const STATUS_OPTIONS: Table['status'][] = ['recommended', 'confirmed', 'in-progress', 'completed', 'cancelled'];
const STATUS_LABEL: Record<Table['status'], string> = {
  recommended: 'recomendada',
  confirmed: 'confirmada',
  'in-progress': 'en curso',
  completed: 'completada',
  cancelled: 'cancelada',
};

interface EditDraft {
  startTime: string;
  endTime: string;
  playerIds: string[];
  /** Who explains the table: chosen here, or '' when nobody who is left can. */
  explainerId: string;
}

export default function TablesPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [addPlayerId, setAddPlayerId] = useState('');

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      setAuthorized(ok);
      if (ok) setEvent(await getEvent(code));
    });
    getPlayers(code).then(setPlayers);
    getGames(code).then(setGames);
    // Tables the system dissolved while they were still waiting for players were never cancelled by anyone: not listed
    // (a cancelled table that was waiting for its explainer is the same case, from before the mark existed)
    const unsub = subscribeTables(code, (ts) => setTables(ts.filter((t) => !(t.status === 'cancelled' && (t.dissolved || t.awaitingExplainer)))));
    return unsub;
  }, [code, adminToken]);

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const playerMap = new Map(players.map((p) => [p.id, p]));
  const gameMap = new Map(games.map((g) => [g.id, g]));

  // A table is "ideal" when it's still full of hearts: worth surfacing so the admin can
  // confirm it with one click instead of hunting for it.
  function isIdealTable(t: Table): boolean {
    const game = gameMap.get(t.gameId);
    if (!game || t.playerIds.length === 0 || t.playerIds.length < game.maxPlayers) return false;
    return t.playerIds.every((pid) => playerMap.get(pid)?.interests[t.gameId] === 'yes');
  }

  // Groups sessions by physical table slot so numbering matches the public board exactly
  const { assignments } = assignPhysicalSlots(tables, event.settings.bufferMinutes);
  const slotGroups = new Map<number, Table[]>();
  for (const a of assignments) {
    const group = slotGroups.get(a.slot) ?? [];
    group.push(a.table);
    slotGroups.set(a.slot, group);
  }
  const sortedSlots = [...slotGroups.keys()].sort((a, b) => a - b);
  for (const slot of sortedSlots) {
    slotGroups.get(slot)!.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  }

  function startEdit(t: Table) {
    setEditingId(t.id);
    setDraft({ startTime: t.startTime, endTime: t.endTime, playerIds: [...t.playerIds], explainerId: t.explainerId });
    setAddPlayerId('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setAddPlayerId('');
  }

  // Other tables of the same game this one can't share its copy with at the given time (empty when all fit)
  function clashesFor(t: Table, start: string, end: string): Table[] {
    return sameGameOverlaps({
      tables, table: t, start, end, bufferMinutes: event!.settings.bufferMinutes,
      gameCopies: games.filter((g) => (g.groupId ?? g.id) === t.gameId).length || 1,
    });
  }

  async function saveEdit(t: Table) {
    if (!draft) return;
    const clashes = clashesFor(t, draft.startTime, draft.endTime);
    if (clashes.length > 0 && !window.confirm(
      `Ese horario se superpone con ${clashes.map((c) => `la mesa de ${c.gameName} de ${c.startTime} a ${c.endTime}`).join(' y ')}, y el juego no tiene otra copia libre. ¿Guardar igual?`
    )) return;
    // The explainer has to be someone sitting at the table. With nobody who can explain it, the table can't be played: it is
    // undone (its people go back to the pool), after asking
    const explainerId = draft.playerIds.includes(draft.explainerId) ? draft.explainerId : '';
    if (!explainerId && draft.playerIds.length > 0) {
      if (!window.confirm(`Ninguno de los jugadores de la mesa de ${t.gameName} marcó que sabe explicarla, y no elegiste quién la explica. Sin explicador la mesa se deshace y la gente vuelve a quedar libre. ¿Deshacerla?`)) return;
      await dissolveTable(code, t);
      cancelEdit();
      return;
    }
    await updateTable(code, t.id, {
      startTime: draft.startTime,
      endTime: draft.endTime,
      playerIds: draft.playerIds,
      explainerId,
    });
    cancelEdit();
  }

  function removePlayer(pid: string, gameId: string) {
    setDraft((d) => {
      if (!d) return d;
      const playerIds = d.playerIds.filter((id) => id !== pid);
      // Taking out the explainer: someone who can explain the game takes over — never just the next one in the list
      const explainerId = d.explainerId === pid ? (nextExplainer([gameId], playerIds, (id) => playerMap.get(id)) ?? '') : d.explainerId;
      return { ...d, playerIds, explainerId };
    });
  }

  function addPlayer() {
    if (!addPlayerId) return;
    setDraft((d) => d ? { ...d, playerIds: [...d.playerIds, addPlayerId] } : d);
    setAddPlayerId('');
  }

  // Ranks candidates for a table's open seat: interested (yes) & free first, then
  // interested-but-busy, then everyone else — so the admin doesn't have to guess who fits.
  function candidatesFor(t: Table, currentIds: string[]) {
    return players
      .filter((p) => !currentIds.includes(p.id))
      .map((p) => {
        const vote = p.interests[t.gameId];
        const busy = tables.some((other) =>
          other.id !== t.id && other.status !== 'cancelled' && other.playerIds.includes(p.id) &&
          toMinutes(other.startTime) < toMinutes(t.endTime) && toMinutes(other.endTime) > toMinutes(t.startTime)
        );
        const rank = (vote === 'yes' ? 0 : 1) + (busy ? 10 : 0);
        const label = (vote === 'yes' ? '👍 ' : '') + p.name + (busy ? ' (ocupado)' : '');
        return { player: p, rank, label };
      })
      .sort((a, b) => a.rank - b.rank);
  }

  return (
    <main className='max-w-2xl mx-auto px-4 py-10'>
      <div className='flex items-center gap-3 mb-6'>
        <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
        <h1 className='text-xl font-bold'>Gestionar mesas — {event.name}</h1>
      </div>

      {tables.length === 0 ? (
        <p className='text-gray-500 text-center py-12'>No hay mesas todavía. Generá desde el panel.</p>
      ) : (
        <div className='space-y-8'>
          {sortedSlots.map((slot) => (
            <div key={slot}>
              <h2 className='text-lg font-bold text-yellow-400 mb-3'>Mesa #{slot + 1}</h2>
              <div className='space-y-3'>
                {slotGroups.get(slot)!.map((t) => {
                  const isEditing = editingId === t.id;
                  const currentIds = isEditing && draft ? draft.playerIds : t.playerIds;
                  const candidates = candidatesFor(t, currentIds);
                  return (
                    <div key={t.id} className='border border-gray-700 rounded-xl p-4 bg-gray-800 space-y-3'>
                      <div className='flex justify-between items-start gap-2'>
                        <div>
                          {t.isManuallyEdited && <span className='mr-2 text-xs bg-orange-900 text-orange-300 px-1.5 rounded'>editada</span>}
                          {t.status === 'recommended' && isIdealTable(t) && (
                            <span className='mr-2 text-xs bg-green-900 text-green-300 px-1.5 rounded'>✅ ideal</span>
                          )}
                          <p className='font-medium'>{t.gameName}</p>
                          {!isEditing && (t.status === 'recommended' || t.status === 'confirmed') && (() => {
                            // A table reserves the time the game takes with every seat taken (see expectedTableEnd)
                            const game = gameMap.get(t.gameId);
                            const end = game ? expectedTableEnd(t, game) : t.endTime;
                            if (end === t.endTime) return null;
                            return (
                              <p className='text-xs text-amber-300 flex flex-wrap items-center gap-x-2'>
                                <span>⏱️ Con los tiempos del juego, la mesa reserva hasta las {end}; su horario dice {t.endTime}.</span>
                                <button onClick={() => setTableEnd(code, t.id, end)}
                                  className='border border-amber-700 rounded px-1.5 py-0.5 hover:bg-amber-950/40'>Ajustar a {end}</button>
                              </p>
                            );
                          })()}
                          {(t.status === 'recommended' || t.status === 'confirmed' || t.status === 'in-progress') && (() => {
                            const clashes = clashesFor(t, t.startTime, t.endTime);
                            return clashes.length > 0 && (
                              <p className='text-xs text-amber-300'>
                                ⚠️ Superpuesta con {clashes.map((c) => `la de ${c.startTime}–${c.endTime} (${STATUS_LABEL[c.status]})`).join(' y ')}: no hay otra copia del juego
                              </p>
                            );
                          })()}
                          {isEditing && draft ? (
                            <div className='flex gap-2 mt-1'>
                              <Time24Input label='Hora de inicio' value={draft.startTime}
                                onChange={(v) => setDraft((d) => d ? { ...d, startTime: v } : d)} />
                              <span className='self-center text-gray-500'>–</span>
                              <Time24Input label='Hora de fin' value={draft.endTime}
                                onChange={(v) => setDraft((d) => d ? { ...d, endTime: v } : d)} />
                            </div>
                          ) : (
                            <p className='text-sm text-gray-400'>{t.startTime}–{t.endTime} · Lote {t.batchNumber}</p>
                          )}
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          <select
                            value={t.status}
                            onChange={(e) => updateTableStatus(code, t.id, e.target.value as Table['status'], true)}
                            className='text-sm border border-gray-700 bg-gray-900 rounded-lg px-2 py-1'
                          >
                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'recommended' && t.postedByOwner ? 'postulada' : STATUS_LABEL[s]}</option>)}
                          </select>
                          {!isEditing && t.status === 'recommended' && isIdealTable(t) && (
                            <button onClick={() => updateTableStatus(code, t.id, 'confirmed', true)}
                              className='text-sm border border-green-700 text-green-300 rounded-lg px-2 py-1 hover:bg-green-900'>
                              ✅ Confirmar
                            </button>
                          )}
                          {!isEditing && (
                            <button onClick={() => startEdit(t)}
                              className='text-sm border border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-700'>
                              ✏️ Editar
                            </button>
                          )}
                        </div>
                      </div>

                      <div className='space-y-1'>
                        <p className='text-xs font-semibold text-gray-400'>✅ Confirmados ({currentIds.length})</p>
                        {currentIds.length === 0 && <p className='text-xs text-gray-500'>Nadie todavía.</p>}
                        {(() => {
                          const explainerNow = isEditing && draft ? draft.explainerId : t.explainerId;
                          return (
                            <>
                              {currentIds.length > 0 && !currentIds.includes(explainerNow) && (t.status === 'recommended' || t.status === 'confirmed') && (
                                <p className='text-xs text-amber-300'>⚠️ Sin explicador{isEditing ? ': elegí quién la explica con “🎓 Que explique”; si no, al guardar la mesa se deshace' : ''}</p>
                              )}
                              {currentIds.map((pid) => {
                                const p = playerMap.get(pid);
                                const canExplain = !!p?.canExplain.includes(t.gameId);
                                return (
                                  <div key={pid} className='flex items-center justify-between gap-2 text-sm'>
                                    <span className='flex items-center gap-2 min-w-0'>
                                      <span className='truncate'>{p?.name ?? pid}</span>
                                      {pid === explainerNow && <span className='text-xs bg-purple-900 text-purple-300 px-1.5 rounded shrink-0'>explica</span>}
                                    </span>
                                    {isEditing && (
                                      <span className='flex items-center gap-3 shrink-0'>
                                        {pid !== explainerNow && (
                                          <button onClick={() => setDraft((d) => d ? { ...d, explainerId: pid } : d)}
                                            title={canExplain ? 'Que explique la mesa' : 'No marcó que sabe explicar este juego'}
                                            className={'text-xs hover:underline ' + (canExplain ? 'text-purple-300' : 'text-gray-500')}>
                                            🎓 Que explique{canExplain ? '' : ' (no marcó que sabe)'}
                                          </button>
                                        )}
                                        <button onClick={() => removePlayer(pid, t.gameId)} className='text-red-400 hover:text-red-300 text-xs'>✕ quitar</button>
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>

                      {(() => {
                        // Voted yes for the game and was offered this table, but hasn't accepted it (yet): interest, not a seat
                        const seatedIds = new Set(currentIds);
                        const rejected = new Set(t.rejectedIds ?? []);
                        const offered = new Set((t.candidateIds ?? []).filter((id) => !seatedIds.has(id)));
                        const queued = new Set((t.queuedIds ?? []).filter((id) => !seatedIds.has(id) && !offered.has(id)));
                        const buf = event.settings.bufferMinutes;
                        const sMin = toMinutes(t.startTime);
                        const eMin = toMinutes(t.endTime);
                        // Everyone who voted yes for the game counts as interested, offered the table or not: when they
                        // aren't, the reason is shown (it doesn't fit their hours, or they play something else then)
                        const rows = players
                          .filter((p) => !seatedIds.has(p.id) && !rejected.has(p.id) && (p.interests[t.gameId] === 'yes' || offered.has(p.id) || queued.has(p.id)))
                          .map((p) => {
                            let note: string;
                            if (offered.has(p.id)) note = 'tiene la mesa ofrecida';
                            else if (queued.has(p.id)) note = 'espera que alguien acepte explicarla';
                            else if (sMin < toMinutes(p.arrivalTime) + buf || eMin > toMinutes(p.departureTime)) note = 'no le entra el horario';
                            else if (tables.some((o) => o.id !== t.id && (o.status === 'confirmed' || o.status === 'in-progress') && o.playerIds.includes(p.id)
                              && toMinutes(o.startTime) - buf < eMin && toMinutes(o.endTime) + buf > sMin)) note = 'juega otra mesa a esa hora';
                            else note = 'votó que sí, todavía sin oferta';
                            return { p, note, order: offered.has(p.id) ? 0 : queued.has(p.id) ? 1 : note.startsWith('votó') ? 2 : 3 };
                          })
                          .sort((a, b) => a.order - b.order);
                        if (rows.length === 0) return null;
                        return (
                          <div className='space-y-1 pt-2 border-t border-gray-700'>
                            <p className='text-xs font-semibold text-gray-400'>👍 Interesados ({rows.length})</p>
                            {rows.map(({ p, note }) => (
                              <p key={p.id} className='text-sm text-gray-300'>{p.name}
                                <span className='text-xs text-gray-500'> · {note}</span></p>
                            ))}
                          </div>
                        );
                      })()}

                      {isEditing && (
                        <div className='flex gap-2 items-center pt-2 border-t border-gray-700'>
                          <select value={addPlayerId} onChange={(e) => setAddPlayerId(e.target.value)}
                            className='flex-1 text-sm border border-gray-700 bg-gray-900 rounded-lg px-2 py-1'>
                            <option value=''>+ Agregar jugador...</option>
                            {candidates.map((c) => <option key={c.player.id} value={c.player.id}>{c.label}</option>)}
                          </select>
                          <button onClick={addPlayer} disabled={!addPlayerId}
                            className='text-sm border border-gray-700 rounded-lg px-3 py-1 hover:bg-gray-700 disabled:opacity-50'>
                            Agregar
                          </button>
                        </div>
                      )}

                      {isEditing && (
                        <div className='flex gap-2 justify-end pt-1'>
                          <button onClick={cancelEdit} className='text-sm border border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-700'>
                            Cancelar
                          </button>
                          <button onClick={() => saveEdit(t)}
                            className='text-sm bg-indigo-600 text-white rounded-lg px-3 py-1.5 font-medium hover:bg-indigo-700'>
                            💾 Guardar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
