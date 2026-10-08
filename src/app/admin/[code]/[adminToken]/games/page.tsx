'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getEvent, verifyAdminToken, subscribeAllGames, subscribePlayers, mergeGames, autoMergeDuplicates, ungroupGame, updateGame,
  transferGameVotes, discardDeletedGame,
} from '@/lib/firestore';
import { searchBgg, getBggGameDetails, isBggUrl, type BggSearchResult } from '@/lib/bgg';
import { roundUp5 } from '@/lib/timeUtils';
import type { MeepleEvent, Game, Player, GameComplexity } from '@/lib/types';

const COMPLEXITY_LABEL: Record<GameComplexity, string> = { light: 'Liviano', medium: 'Intermedio', heavy: 'Pesado' };

interface EditDraft {
  name: string;
  bggUrl: string | null;
  imageUrl: string | null;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  complexity: GameComplexity;
  perPlayerMinutes: number | null;
  setupMinutes: number | null;
  explanationMinutes: number | null;
  lendable: boolean;
}

export default function GamesPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergePrimaryId, setMergePrimaryId] = useState('');
  const [autoMerging, setAutoMerging] = useState(false);
  const [merging, setMerging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [transferTargetId, setTransferTargetId] = useState<Record<string, string>>({});
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      setAuthorized(ok);
      if (ok) setEvent(await getEvent(code));
    });
    const unsubG = subscribeAllGames(code, setGames);
    const unsubP = subscribePlayers(code, setPlayers);
    return () => { unsubG(); unsubP(); };
  }, [code, adminToken]);

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const activeGames = games.filter((g) => !g.deleted);
  const deletedGames = games.filter((g) => g.deleted);
  const gameMap = new Map(activeGames.map((g) => [g.id, g]));

  // Groups every game by its canonical id (the primary's own id, or itself if ungrouped) so
  // merged duplicates render as a single row with combined owners and vote counts.
  const groups = new Map<string, Game[]>();
  activeGames.forEach((g) => {
    const canonical = g.groupId ?? g.id;
    const arr = groups.get(canonical) ?? [];
    arr.push(g);
    groups.set(canonical, arr);
  });

  function votesFor(gameId: string) {
    const yes = players.filter((p) => p.interests[gameId] === 'yes').length;
    const no = players.filter((p) => p.interests[gameId] === 'no').length;
    const explainers = players.filter((p) => p.canExplain.includes(gameId)).length;
    return { yes, no, explainers };
  }

  async function handleTransfer(fromId: string) {
    const toId = transferTargetId[fromId];
    if (!toId || transferringId) return;
    setTransferringId(fromId);
    try {
      await transferGameVotes(code, fromId, toId);
      setTransferTargetId((cur) => { const next = { ...cur }; delete next[fromId]; return next; });
    } finally {
      setTransferringId(null);
    }
  }

  async function handleDiscard(gameId: string) {
    if (!confirm('¿Descartar este juego y todos los votos que tiene? Esta acción no se puede deshacer.')) return;
    setDiscardingId(gameId);
    try {
      await discardDeletedGame(code, gameId);
    } finally {
      setDiscardingId(null);
    }
  }

  const rows = [...groups.entries()].map(([canonicalId, copies]) => {
    const primary = copies.find((g) => g.id === canonicalId) ?? copies[0];
    const yes = players.filter((p) => p.interests[primary.id] === 'yes').length;
    const no = players.filter((p) => p.interests[primary.id] === 'no').length;
    const explainers = players.filter((p) => p.canExplain.includes(primary.id)).length;
    return { primary, copies, yes, no, explainers, total: yes };
  }).sort((a, b) => b.yes - a.yes);

  function toggleSelect(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]);
  }

  async function handleMerge() {
    if (selectedIds.length < 2 || !mergePrimaryId || merging) return;
    setMerging(true);
    try {
      await mergeGames(code, selectedIds, mergePrimaryId);
      setSelectedIds([]);
      setMergePrimaryId('');
    } finally {
      setMerging(false);
    }
  }

  async function handleAutoMerge() {
    if (autoMerging) return;
    setAutoMerging(true);
    try {
      await autoMergeDuplicates(code, 'bggUrl');
    } finally {
      setAutoMerging(false);
    }
  }

  function startEdit(g: Game) {
    setEditingId(g.id);
    setEditDraft({
      name: g.name, bggUrl: g.bggUrl, imageUrl: g.imageUrl ?? null,
      minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
      durationMinutes: g.durationMinutes, complexity: g.complexity,
      perPlayerMinutes: g.perPlayerMinutes ?? null,
      setupMinutes: g.setupMinutes ?? null,
      explanationMinutes: g.explanationMinutes ?? null,
      lendable: !!g.lendable,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit(gameId: string) {
    if (!editDraft || savingEdit) return;
    setSavingEdit(true);
    try {
      // durationMinutes has no direct input anymore — kept as a pessimistic fallback estimate
      // (setup + explanation + per-player time × max players) for display/legacy code.
      const estimatedDurationMinutes = roundUp5((editDraft.setupMinutes ?? 0) + (editDraft.explanationMinutes ?? 0) + (editDraft.perPlayerMinutes ?? 0) * editDraft.maxPlayers);
      await updateGame(code, gameId, { ...editDraft, durationMinutes: estimatedDurationMinutes || editDraft.durationMinutes });
      cancelEdit();
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <main className='max-w-2xl mx-auto px-4 py-10'>
      <div className='flex items-center gap-3 mb-6'>
        <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
        <h1 className='text-xl font-bold'>Juegos — {event.name}</h1>
        <span className='text-sm text-gray-500'>{activeGames.length}</span>
      </div>

      <p className='text-xs text-gray-500 mb-4'>
        Tildá dos o más juegos que en realidad son copias del mismo (ej. cargados con nombres distintos) y fusionalos:
        se combinan los votos de cada jugador (el más fuerte de los dos) y se agenda como un solo juego con varias
        copias disponibles en simultáneo.
      </p>
      <div className='flex items-center gap-3 mb-4'>
        <button onClick={handleAutoMerge} disabled={autoMerging}
          className='text-sm border border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-800 disabled:opacity-50'>
          {autoMerging ? 'Uniendo...' : '🧩 Unir duplicados (mismo link de BGG)'}
        </button>
        <span className='text-xs text-gray-500'>Pasa solo con los juegos nuevos; esto limpia los que ya estaban cargados.</span>
      </div>

      {selectedIds.length >= 2 && (
        <div className='sticky top-2 z-10 mb-4 border border-indigo-700 bg-indigo-950 rounded-xl p-3 flex flex-wrap items-center gap-2'>
          <span className='text-sm'>{selectedIds.length} seleccionados —</span>
          <select value={mergePrimaryId} onChange={(e) => setMergePrimaryId(e.target.value)}
            className='text-sm border border-gray-700 bg-gray-900 rounded-lg px-2 py-1'>
            <option value=''>¿Cuál nombre/datos usar?</option>
            {selectedIds.map((id) => {
              const g = gameMap.get(id);
              return g ? <option key={id} value={id}>{g.name} (de {g.ownerName})</option> : null;
            })}
          </select>
          <button onClick={handleMerge} disabled={!mergePrimaryId || merging}
            className='text-sm bg-indigo-600 rounded-lg px-3 py-1 hover:bg-indigo-700 disabled:opacity-40'>
            {merging ? 'Fusionando...' : '🧩 Fusionar'}
          </button>
          <button onClick={() => { setSelectedIds([]); setMergePrimaryId(''); }}
            className='text-sm text-gray-400 hover:text-gray-200'>
            Cancelar
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className='text-gray-500 text-center py-12'>Todavía no hay juegos cargados.</p>
      ) : (
        <div className='space-y-2'>
          {rows.map(({ primary, copies, yes, no, explainers, total }) => {
            const notEnough = total < primary.minPlayers;
            const isGroup = copies.length > 1;
            return (
              <div key={primary.id} className={'border rounded-xl p-3 bg-gray-800 ' + (notEnough ? 'border-amber-800' : 'border-gray-700')}>
                <div className='flex justify-between items-start gap-2'>
                  <div className='flex items-start gap-2 flex-1 min-w-0'>
                    <input type='checkbox' className='mt-1' checked={selectedIds.includes(primary.id)}
                      onChange={() => toggleSelect(primary.id)} />
                    <div className='flex-1 min-w-0'>
                      <p className='font-semibold flex items-center gap-2'>
                        {primary.name}
                        {isGroup && <span className='text-xs bg-indigo-900 text-indigo-300 px-1.5 rounded'>🧩 {copies.length} copias</span>}
                        {editingId !== primary.id && (
                          <button onClick={() => startEdit(primary)} className='text-xs text-indigo-400 hover:underline'>
                            ✏️ editar
                          </button>
                        )}
                      </p>
                      {editingId === primary.id && editDraft ? (
                        <GameEditForm draft={editDraft} onChange={setEditDraft} onSave={() => saveEdit(primary.id)} onCancel={cancelEdit} saving={savingEdit} />
                      ) : (
                        <p className='text-xs text-gray-500'>
                          Trae: {copies.map((c) => c.ownerName).join(', ')} · {primary.minPlayers}–{primary.maxPlayers}p · {roundUp5(primary.durationMinutes)}min
                        </p>
                      )}
                    </div>
                  </div>
                  {notEnough && <span className='text-xs text-amber-400 shrink-0'>⚠️ Faltan votos ({total}/{primary.minPlayers})</span>}
                </div>
                <div className='flex gap-3 mt-2 text-sm'>
                  <span className='text-blue-300'>👍 {yes}</span>
                  <span className='text-gray-500'>👎 {no}</span>
                  <span className='text-purple-300'>🎓 {explainers} explica{explainers !== 1 ? 'n' : ''}</span>
                </div>
                {isGroup && (
                  <div className='mt-2 pt-2 border-t border-gray-700 space-y-1'>
                    {copies.map((c) => (
                      <div key={c.id}>
                        <div className='flex items-center justify-between text-xs text-gray-400'>
                        <span className='flex items-center gap-2'>
                          <input type='checkbox' checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                          {c.name} (de {c.ownerName}){c.id === primary.id && ' · principal'}
                        </span>
                        <span className='flex items-center gap-2'>
                          {c.id !== primary.id && (
                            <button onClick={() => startEdit(c)} className='text-indigo-400 hover:underline'>
                              editar
                            </button>
                          )}
                          {c.id !== primary.id && (
                            <button onClick={() => ungroupGame(code, c.id)} className='text-red-400 hover:text-red-300'>
                              separar
                            </button>
                          )}
                        </span>
                        </div>
                        {editingId === c.id && editDraft && (
                          <GameEditForm draft={editDraft} onChange={setEditDraft} onSave={() => saveEdit(c.id)} onCancel={cancelEdit} saving={savingEdit} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deletedGames.length > 0 && (
        <div className='mt-8'>
          <h2 className='font-semibold text-amber-300 mb-1'>🗑️ Juegos eliminados con votos pendientes</h2>
          <p className='text-xs text-gray-500 mb-3'>
            Sus dueños los borraron, pero ya habían juntado votos — quedaron acá en vez de perderse. Transferí esos
            votos a otro juego (ej. si en realidad era una copia de algo que ya está cargado) o descartalos.
          </p>
          <div className='space-y-2'>
            {deletedGames.map((g) => {
              const { yes, no, explainers } = votesFor(g.id);
              return (
                <div key={g.id} className='border border-amber-800 bg-amber-950/20 rounded-xl p-3'>
                  <p className='font-semibold'>{g.name}</p>
                  <p className='text-xs text-gray-500'>Traía: {g.ownerName}</p>
                  <div className='flex gap-3 mt-1 text-sm'>
                    <span className='text-blue-300'>👍 {yes}</span>
                    <span className='text-gray-500'>👎 {no}</span>
                    <span className='text-purple-300'>🎓 {explainers} explica{explainers !== 1 ? 'n' : ''}</span>
                  </div>
                  <div className='flex flex-wrap gap-2 mt-2'>
                    <select value={transferTargetId[g.id] ?? ''}
                      onChange={(e) => setTransferTargetId((cur) => ({ ...cur, [g.id]: e.target.value }))}
                      className='text-sm border border-gray-700 bg-gray-900 rounded-lg px-2 py-1'>
                      <option value=''>Transferir votos a...</option>
                      {activeGames.filter((ag) => !ag.groupId || ag.groupId === ag.id).map((ag) => (
                        <option key={ag.id} value={ag.id}>{ag.name} (de {ag.ownerName})</option>
                      ))}
                    </select>
                    <button onClick={() => handleTransfer(g.id)} disabled={!transferTargetId[g.id] || transferringId === g.id}
                      className='text-sm bg-indigo-600 rounded-lg px-3 py-1 hover:bg-indigo-700 disabled:opacity-40'>
                      {transferringId === g.id ? 'Transfiriendo...' : 'Transferir'}
                    </button>
                    <button onClick={() => handleDiscard(g.id)} disabled={discardingId === g.id}
                      className='text-sm border border-red-800 text-red-400 rounded-lg px-3 py-1 hover:bg-red-950 disabled:opacity-40'>
                      {discardingId === g.id ? 'Descartando...' : 'Descartar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

function GameEditForm({
  draft, onChange, onSave, onCancel, saving,
}: {
  draft: EditDraft;
  onChange: (d: EditDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [bggResults, setBggResults] = useState<BggSearchResult[]>([]);
  const [bggOpen, setBggOpen] = useState(false);
  const [bggLoading, setBggLoading] = useState(false);
  const skipBggSearchRef = useRef(false);

  useEffect(() => {
    if (skipBggSearchRef.current) { skipBggSearchRef.current = false; return; }
    const query = draft.name.trim();
    if (query.length < 3) { setBggResults([]); setBggOpen(false); return; }
    const handle = setTimeout(async () => {
      setBggLoading(true);
      try {
        const results = await searchBgg(query);
        setBggResults(results);
        setBggOpen(results.length > 0);
      } catch (err) {
        console.error(err);
        setBggResults([]);
      } finally {
        setBggLoading(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [draft.name]);

  async function selectBggResult(result: BggSearchResult) {
    skipBggSearchRef.current = true;
    setBggOpen(false);
    setBggResults([]);
    try {
      const details = await getBggGameDetails(result.id);
      onChange({
        ...draft, name: result.name, bggUrl: details.bggUrl, imageUrl: details.imageUrl,
        minPlayers: details.minPlayers, maxPlayers: details.maxPlayers, complexity: details.complexity,
      });
    } catch (err) {
      console.error(err);
      skipBggSearchRef.current = true;
      onChange({ ...draft, name: result.name });
    }
  }

  return (
    <div className='mt-2 space-y-3 border border-gray-700 rounded-lg p-2 bg-gray-900'>
      <div className='relative'>
        <svg className='absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none'
          fill='none' viewBox='0 0 24 24' stroke='currentColor' strokeWidth={2}>
          <circle cx='11' cy='11' r='7' />
          <line x1='21' y1='21' x2='16.65' y2='16.65' />
        </svg>
        <input className='w-full border border-gray-700 bg-gray-900 rounded-lg pl-8 pr-2 py-1 text-sm' placeholder='Buscar en BGG...'
          value={draft.name}
          onChange={(e) => {
            const name = e.target.value;
            onChange(name ? { ...draft, name } : { ...draft, name, imageUrl: null, bggUrl: null });
          }}
          onFocus={() => { if (bggResults.length > 0) setBggOpen(true); }}
          onBlur={() => setTimeout(() => setBggOpen(false), 150)} />
        {bggLoading && <p className='text-xs text-gray-500 mt-1'>Buscando en BGG...</p>}
        {bggOpen && bggResults.length > 0 && (
          <div className='absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-lg max-h-56 overflow-y-auto'>
            {bggResults.map((r) => (
              <button key={r.id} type='button'
                onMouseDown={(e) => { e.preventDefault(); selectBggResult(r); }}
                className='w-full text-left px-3 py-2 text-sm hover:bg-gray-800 flex items-center gap-2'>
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt='' className='w-10 h-10 rounded object-cover border border-gray-700 shrink-0' />
                ) : (
                  <div className='w-10 h-10 rounded bg-gray-800 border border-gray-700 shrink-0 flex items-center justify-center text-lg text-gray-600'>
                    🎲
                  </div>
                )}
                <span className='truncate flex-1'>{r.name}</span>
                {r.year && <span className='text-gray-500 text-xs shrink-0'>{r.year}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className='relative'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={draft.imageUrl || '/cover-placeholder.png'} alt=''
          className='w-full aspect-[41/50] rounded-md object-contain bg-gray-900 border border-gray-700' />
        {(draft.imageUrl || isBggUrl(draft.bggUrl)) && (
          <button type='button' onClick={() => onChange({ ...draft, imageUrl: null, bggUrl: null })}
            aria-label='Quitar' title='Quitar'
            className='absolute top-2 right-2 w-7 h-7 rounded-full bg-gray-900/80 border border-gray-700 text-gray-300 hover:bg-gray-800 flex items-center justify-center text-sm'>
            ✕
          </button>
        )}
      </div>
      {isBggUrl(draft.bggUrl) && (
        <a href={draft.bggUrl} target='_blank' rel='noopener noreferrer'
          className='flex items-center justify-center gap-2 text-base font-medium text-indigo-400 hover:underline text-center'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src='/bgg-icon.png' alt='' className='w-5 h-5 shrink-0' />
          {draft.name}
        </a>
      )}

      <div className='border border-gray-800 rounded-lg p-2 space-y-2'>
        <p className='text-xs font-semibold text-gray-300'>Cantidad de jugadores</p>
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <label className='text-xs text-gray-400'>🧑‍🤝‍🧑 ¿Cuánto creés vos que es el mínimo recomendado?
              {isBggUrl(draft.bggUrl) && <span className='ml-1.5 text-[9px] bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded align-middle'>BGG</span>}
            </label>
            <input type='number' min={1} max={20} className='w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm'
              value={draft.minPlayers} onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
              onChange={(e) => onChange({ ...draft, minPlayers: +e.target.value })} />
          </div>
          <div>
            <label className='text-xs text-gray-400'>🧑‍🤝‍🧑 ¿Cuánto creés vos que es el máximo recomendado?
              {isBggUrl(draft.bggUrl) && <span className='ml-1.5 text-[9px] bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded align-middle'>BGG</span>}
            </label>
            <input type='number' min={1} max={20} className='w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm'
              value={draft.maxPlayers} onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
              onChange={(e) => onChange({ ...draft, maxPlayers: +e.target.value })} />
          </div>
        </div>
      </div>

      <p className='text-xs text-gray-500 px-1'>
        🤝 ¿Presta esta copia aunque no juegue esa mesa? <span className='text-gray-300'>{draft.lendable ? 'Sí' : 'No'}</span>
        <span className='text-gray-600'> — lo decide el dueño, no se edita acá.</span>
      </p>

      <div className='border border-gray-800 rounded-lg p-2 space-y-2'>
        <p className='text-xs font-semibold text-gray-300'>🧩 ¿Qué tan complejo es?
          {isBggUrl(draft.bggUrl) && <span className='ml-1.5 text-[9px] bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded align-middle'>BGG</span>}
        </p>
        <select className='w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm'
          value={draft.complexity}
          onChange={(e) => onChange({ ...draft, complexity: e.target.value as GameComplexity })}>
          {(['light', 'medium', 'heavy'] as GameComplexity[]).map((c) => (
            <option key={c} value={c}>{COMPLEXITY_LABEL[c]}</option>
          ))}
        </select>
      </div>

      <div className='border border-gray-800 rounded-lg p-2 space-y-2'>
        <p className='text-xs font-semibold text-gray-300'>Tiempo</p>
        <p className='text-xs text-gray-500'>La duración real que usa el algoritmo se calcula sola según cuántos jugadores termine teniendo cada mesa.</p>
        <div className='grid grid-cols-2 gap-2'>
          <div>
            <label className='text-xs text-gray-400'>⏱️ ¿Cuánto tiempo por jugador? (min)</label>
            <input type='number' min={0} className='w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm'
              value={draft.perPlayerMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder='—'
              onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
              onChange={(e) => onChange({ ...draft, perPlayerMinutes: e.target.value ? +e.target.value : null })} />
          </div>
          <div>
            <label className='text-xs text-gray-400'>🛠️ ¿Cuánto tiempo de armado? (min)</label>
            <input type='number' min={0} className='w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm'
              value={draft.setupMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder='—'
              onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
              onChange={(e) => onChange({ ...draft, setupMinutes: e.target.value ? +e.target.value : null })} />
          </div>
          <div>
            <label className='text-xs text-gray-400'>📚 ¿Cuánto tiempo de explicación? (min)</label>
            <input type='number' min={0} className='w-full border border-gray-700 bg-gray-900 rounded-lg px-2 py-1 text-sm'
              value={draft.explanationMinutes ?? ''} onFocus={(e) => e.target.select()} placeholder='—'
              onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
              onChange={(e) => onChange({ ...draft, explanationMinutes: e.target.value ? +e.target.value : null })} />
          </div>
        </div>
        <p className='text-[11px] text-gray-500'>* Todos los campos de tiempo son obligatorios.</p>
      </div>

      <div className='flex gap-2'>
        <button onClick={onCancel} className='flex-1 border border-gray-700 rounded-lg py-1 text-xs font-medium'>
          Cancelar
        </button>
        <button onClick={onSave}
          disabled={saving || !draft.name.trim() || draft.perPlayerMinutes == null || draft.setupMinutes == null || draft.explanationMinutes == null}
          className='flex-1 bg-indigo-600 rounded-lg py-1 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50'>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  );
}

