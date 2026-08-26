'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribeTables, updateTableStatus, updateTable, getPlayers } from '@/lib/firestore';
import { toMinutes } from '@/lib/timeUtils';
import { assignPhysicalSlots } from '@/lib/physicalSlots';
import type { MeepleEvent, Table, Player } from '@/lib/types';

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
    const unsub = subscribeTables(code, setTables);
    return unsub;
  }, [code, adminToken]);

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const playerMap = new Map(players.map((p) => [p.id, p]));

  // Groups sessions by physical table slot so numbering matches the public board exactly
  const { assignments } = assignPhysicalSlots(tables);
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
                  const availableToAdd = players.filter((p) => !currentIds.includes(p.id));
                  return (
                    <div key={t.id} className='border border-gray-700 rounded-xl p-4 bg-gray-800 space-y-3'>
                      <div className='flex justify-between items-start gap-2'>
                        <div>
                          {t.isManuallyEdited && <span className='mr-2 text-xs bg-orange-900 text-orange-300 px-1.5 rounded'>editada</span>}
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
                          return (
                            <div key={pid} className='flex items-center justify-between text-sm'>
                              <span className='flex items-center gap-2'>
                                {p?.name ?? pid}
                                {pid === t.explainerId && <span className='text-xs bg-purple-900 text-purple-300 px-1.5 rounded'>explica</span>}
                              </span>
                              {isEditing && (
                                <button onClick={() => removePlayer(pid)} className='text-red-400 hover:text-red-300 text-xs'>✕ quitar</button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isEditing && (
                        <div className='flex gap-2 items-center pt-2 border-t border-gray-700'>
                          <select value={addPlayerId} onChange={(e) => setAddPlayerId(e.target.value)}
                            className='flex-1 text-sm border border-gray-700 bg-gray-900 rounded-lg px-2 py-1'>
                            <option value=''>+ Agregar jugador...</option>
                            {availableToAdd.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
