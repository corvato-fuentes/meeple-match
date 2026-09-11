'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribeTables, updateTableStatus, updateTable, getPlayers, getGames } from '@/lib/firestore';
import { toMinutes } from '@/lib/timeUtils';
import { assignPhysicalSlots } from '@/lib/physicalSlots';
import type { MeepleEvent, Table, Player, Game } from '@/lib/types';

const STATUS_OPTIONS: Table['status'][] = ['proposed', 'confirmed', 'in-progress', 'completed', 'cancelled'];

interface EditDraft {
  startTime: string;
  endTime: string;
  playerIds: string[];
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
    const unsub = subscribeTables(code, setTables);
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
    const allHearts = t.playerIds.every((pid) => playerMap.get(pid)?.interests[t.gameId] === 'must');
    if (!allHearts) return false;
    if (t.explainerIsPlaying === false) {
      return playerMap.get(t.explainerId)?.interests[t.gameId] === 'must';
    }
    return true;
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
    setDraft({ startTime: t.startTime, endTime: t.endTime, playerIds: [...t.playerIds] });
    setAddPlayerId('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setAddPlayerId('');
  }

  async function saveEdit(t: Table) {
    if (!draft) return;
    const explainerStillIn = draft.playerIds.includes(t.explainerId);
    await updateTable(code, t.id, {
      startTime: draft.startTime,
      endTime: draft.endTime,
      playerIds: draft.playerIds,
      explainerId: explainerStillIn ? t.explainerId : (draft.playerIds[0] ?? ''),
      explainerIsPlaying: true,
    });
    cancelEdit();
  }

  function removePlayer(pid: string) {
    setDraft((d) => d ? { ...d, playerIds: d.playerIds.filter((id) => id !== pid) } : d);
  }

  function addPlayer() {
    if (!addPlayerId) return;
    setDraft((d) => d ? { ...d, playerIds: [...d.playerIds, addPlayerId] } : d);
    setAddPlayerId('');
  }

  // Ranks candidates for a table's open seat: interested (must/casual) & free first, then
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
        const rank = (vote === 'must' ? 0 : vote === 'casual' ? 1 : 2) + (busy ? 10 : 0);
        const label = (vote === 'must' ? '❤️ ' : vote === 'casual' ? '👍 ' : '') + p.name + (busy ? ' (ocupado)' : '') + (p.noAutoSchedule ? ' 🚫' : '');
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
                          {t.status === 'proposed' && isIdealTable(t) && (
                            <span className='mr-2 text-xs bg-green-900 text-green-300 px-1.5 rounded'>✅ ideal</span>
                          )}
                          <p className='font-medium'>{t.gameName}</p>
                          {isEditing && draft ? (
                            <div className='flex gap-2 mt-1'>
                              <input type='time' value={draft.startTime}
                                onChange={(e) => setDraft((d) => d ? { ...d, startTime: e.target.value } : d)}
                                className='border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm' />
                              <span className='self-center text-gray-500'>–</span>
                              <input type='time' value={draft.endTime}
                                onChange={(e) => setDraft((d) => d ? { ...d, endTime: e.target.value } : d)}
                                className='border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm' />
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
                            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {!isEditing && t.status === 'proposed' && isIdealTable(t) && (
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
                        {currentIds.map((pid) => {
                          const p = playerMap.get(pid);
                          const vote = p?.interests[t.gameId];
                          const voteIcon = vote === 'must' ? '❤️ ' : vote === 'casual' ? '👍 ' : '';
                          return (
                            <div key={pid} className='flex items-center justify-between text-sm'>
                              <span className='flex items-center gap-2'>
                                {voteIcon}{p?.name ?? pid}
                                {pid === t.explainerId && <span className='text-xs bg-purple-900 text-purple-300 px-1.5 rounded'>explica</span>}
                              </span>
                              {isEditing && (
                                <button onClick={() => removePlayer(pid)} className='text-red-400 hover:text-red-300 text-xs'>✕ quitar</button>
                              )}
                            </div>
                          );
                        })}
                        {t.explainerIsPlaying === false && !isEditing && (
                          <div className='flex items-center gap-2 text-sm text-gray-400'>
                            <span>{playerMap.get(t.explainerId)?.name ?? t.explainerId}</span>
                            <span className='text-xs bg-purple-950 text-purple-300 px-1.5 rounded'>explica y se va</span>
                          </div>
                        )}
                      </div>

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
