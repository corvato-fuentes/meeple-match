'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, subscribeGames, subscribePlayers, mergeGames, ungroupGame } from '@/lib/firestore';
import type { MeepleEvent, Game, Player } from '@/lib/types';

export default function GamesPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergePrimaryId, setMergePrimaryId] = useState('');
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      setAuthorized(ok);
      if (ok) setEvent(await getEvent(code));
    });
    const unsubG = subscribeGames(code, setGames);
    const unsubP = subscribePlayers(code, setPlayers);
    return () => { unsubG(); unsubP(); };
  }, [code, adminToken]);

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event) return <div className='p-8 text-center'>Cargando...</div>;

  const gameMap = new Map(games.map((g) => [g.id, g]));

  // Groups every game by its canonical id (the primary's own id, or itself if ungrouped) so
  // merged duplicates render as a single row with combined owners and vote counts.
  const groups = new Map<string, Game[]>();
  games.forEach((g) => {
    const canonical = g.groupId ?? g.id;
    const arr = groups.get(canonical) ?? [];
    arr.push(g);
    groups.set(canonical, arr);
  });

  const rows = [...groups.entries()].map(([canonicalId, copies]) => {
    const primary = copies.find((g) => g.id === canonicalId) ?? copies[0];
    const must = players.filter((p) => p.interests[primary.id] === 'must').length;
    const casual = players.filter((p) => p.interests[primary.id] === 'casual').length;
    const no = players.filter((p) => p.interests[primary.id] === 'no').length;
    const explainers = players.filter((p) => p.canExplain.includes(primary.id)).length;
    return { primary, copies, must, casual, no, explainers, total: must + casual };
  }).sort((a, b) => b.must - a.must || b.casual - a.casual);

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

  return (
    <main className='max-w-2xl mx-auto px-4 py-10'>
      <div className='flex items-center gap-3 mb-6'>
        <Link href={`/admin/${code}/${adminToken}`} className='text-gray-500 hover:text-gray-300'>←</Link>
        <h1 className='text-xl font-bold'>Juegos — {event.name}</h1>
        <span className='text-sm text-gray-500'>{games.length}</span>
        <Link href={`/admin/${code}/${adminToken}/players`}
          className='ml-auto text-xs border border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-800'>
          👥 Ver inscriptos
        </Link>
      </div>

      <p className='text-xs text-gray-500 mb-4'>
        Tildá dos o más juegos que en realidad son copias del mismo (ej. cargados con nombres distintos) y fusionalos:
        se combinan los votos de cada jugador (el más fuerte de los dos) y se agenda como un solo juego con varias
        copias disponibles en simultáneo.
      </p>

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
          {rows.map(({ primary, copies, must, casual, no, explainers, total }) => {
            const notEnough = total < primary.minPlayers;
            const isGroup = copies.length > 1;
            return (
              <div key={primary.id} className={'border rounded-xl p-3 bg-gray-800 ' + (notEnough ? 'border-amber-800' : 'border-gray-700')}>
                <div className='flex justify-between items-start gap-2'>
                  <div className='flex items-start gap-2'>
                    <input type='checkbox' className='mt-1' checked={selectedIds.includes(primary.id)}
                      onChange={() => toggleSelect(primary.id)} />
                    <div>
                      <p className='font-semibold'>
                        {primary.name}
                        {isGroup && <span className='ml-2 text-xs bg-indigo-900 text-indigo-300 px-1.5 rounded'>🧩 {copies.length} copias</span>}
                      </p>
                      <p className='text-xs text-gray-500'>
                        Trae: {copies.map((c) => c.ownerName).join(', ')} · {primary.minPlayers}–{primary.maxPlayers}p · {primary.durationMinutes}min
                      </p>
                    </div>
                  </div>
                  {notEnough && <span className='text-xs text-amber-400 shrink-0'>⚠️ Faltan votos ({total}/{primary.minPlayers})</span>}
                </div>
                <div className='flex gap-3 mt-2 text-sm'>
                  <span className='text-red-300'>❤️ {must}</span>
                  <span className='text-blue-300'>👍 {casual}</span>
                  <span className='text-gray-500'>👎 {no}</span>
                  <span className='text-purple-300'>🎓 {explainers} explica{explainers !== 1 ? 'n' : ''}</span>
                </div>
                {isGroup && (
                  <div className='mt-2 pt-2 border-t border-gray-700 space-y-1'>
                    {copies.map((c) => (
                      <div key={c.id} className='flex items-center justify-between text-xs text-gray-400'>
                        <span className='flex items-center gap-2'>
                          <input type='checkbox' checked={selectedIds.includes(c.id)} onChange={() => toggleSelect(c.id)} />
                          {c.name} (de {c.ownerName}){c.id === primary.id && ' · principal'}
                        </span>
                        {c.id !== primary.id && (
                          <button onClick={() => ungroupGame(code, c.id)} className='text-red-400 hover:text-red-300'>
                            separar
                          </button>
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
    </main>
  );
}

