'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getEvent, verifyAdminToken, updateEventStatus, updateEventSettings, updateEventDetails, subscribePlayers, subscribeTables, saveProposedTables, getTables, getPlayers, getGames, seedFakePlayers, resetEventData, fillTableSeats } from '@/lib/firestore';
import { generateTables, fillExistingTables } from '@/lib/tableAlgorithm';
import { generateFakePlayers } from '@/lib/fakeData';
import { saveMyEvent } from '@/lib/myEvents';
import type { MeepleEvent, Player, Table } from '@/lib/types';

export default function AdminPage() {
  const { code, adminToken } = useParams<{ code: string; adminToken: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<MeepleEvent | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [adminUrl, setAdminUrl] = useState('');
  const [adminCopied, setAdminCopied] = useState(false);
  const [boardUrl, setBoardUrl] = useState('');
  const [showQr, setShowQr] = useState(false);

  const [settingsDraft, setSettingsDraft] = useState<MeepleEvent['settings'] | null>(null);
  const [mapUrlDraft, setMapUrlDraft] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    verifyAdminToken(code, adminToken).then(async (ok) => {
      if (!ok) { setAuthorized(false); return; }
      setAuthorized(true);
      const ev = await getEvent(code);
      setEvent(ev);
      if (ev) {
        setSettingsDraft(ev.settings);
        setMapUrlDraft(ev.mapUrl ?? '');
        saveMyEvent({ code, adminToken, name: ev.name, date: ev.date });
      }
    });
    const unsubP = subscribePlayers(code, setPlayers);
    const unsubT = subscribeTables(code, setTables);
    return () => { unsubP(); unsubT(); };
  }, [code, adminToken]);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/event/${code}`);
    setAdminUrl(`${window.location.origin}/admin/${code}/${adminToken}`);
    setBoardUrl(`${window.location.origin}/event/${code}/board`);
  }, [code, adminToken]);

  async function handleGenerate() {
    if (!event) return;
    setGenerating(true);
    setGenerateMsg(null);
    const [allPlayers, allGames, allTables] = await Promise.all([
      getPlayers(code), getGames(code), getTables(code),
    ]);
    const fills = fillExistingTables(allPlayers, allGames, allTables);
    for (const fill of fills) await fillTableSeats(code, fill.tableId, fill.playerIds);
    const currentTables = fills.length > 0 ? await getTables(code) : allTables;
    const batchNumber = currentTables.length > 0
      ? Math.max(...currentTables.map((t) => t.batchNumber)) + 1
      : 1;
    const proposals = generateTables(allPlayers, allGames, currentTables, event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks);
    await saveProposedTables(code, proposals as any);
    setGenerating(false);
    const filledSeats = fills.reduce((n, f) => n + (f.playerIds.length - (allTables.find((t) => t.id === f.tableId)?.playerIds.length ?? 0)), 0);
    const parts = [];
    if (filledSeats > 0) parts.push(`se sumaron ${filledSeats} jugador${filledSeats === 1 ? '' : 'es'} a mesas existentes`);
    if (proposals.length > 0) parts.push(`se generaron ${proposals.length} mesa${proposals.length === 1 ? '' : 's'} nueva${proposals.length === 1 ? '' : 's'}`);
    setGenerateMsg(parts.length > 0
      ? `✓ ${parts.join(' y ')}.`
      : 'No se generaron mesas nuevas — no hay más combinaciones válidas de jugadores, juegos y horarios disponibles ahora mismo.');
  }

  async function handleSeedFakeData() {
    if (!event) return;
    const cap = event.settings.maxPlayers;
    // Fills all the way up to the configured cap (or a default of 40 if uncapped)
    const count = cap != null ? Math.max(0, cap - players.length) : 40;
    if (count === 0) { alert('El evento ya alcanzó la capacidad máxima configurada — no se pueden agregar más jugadores de prueba.'); return; }
    if (!confirm(`Esto va a crear ${count} jugador${count === 1 ? '' : 'es'} de prueba con juegos y votos aleatorios, y proponer mesas. ¿Continuar?`)) return;
    setSeeding(true);
    setGenerateMsg(null);
    const drafts = generateFakePlayers(count, event);
    await seedFakePlayers(code, drafts);
    const [allPlayers, allGames, allTables] = await Promise.all([
      getPlayers(code), getGames(code), getTables(code),
    ]);
    const fills = fillExistingTables(allPlayers, allGames, allTables);
    for (const fill of fills) await fillTableSeats(code, fill.tableId, fill.playerIds);
    const currentTables = fills.length > 0 ? await getTables(code) : allTables;
    const batchNumber = currentTables.length > 0
      ? Math.max(...currentTables.map((t) => t.batchNumber)) + 1
      : 1;
    const proposals = generateTables(allPlayers, allGames, currentTables, event.settings.bufferMinutes, event.settings.physicalTables, batchNumber, event.settings.breaks);
    await saveProposedTables(code, proposals as any);
    setSeeding(false);
    setGenerateMsg(proposals.length > 0
      ? `✓ Se agregaron ${count} jugadores de prueba y se generaron ${proposals.length} mesa${proposals.length === 1 ? '' : 's'} nueva${proposals.length === 1 ? '' : 's'}.`
      : `✓ Se agregaron ${count} jugadores de prueba, pero no se generaron mesas nuevas.`);
  }


  async function handleResetAndSeed() {
    if (!event) return;
    if (!confirm('Esto va a BORRAR todos los jugadores, juegos y mesas actuales del evento, y crear datos de prueba nuevos desde cero. Esta acción no se puede deshacer. ¿Continuar?')) return;
    setResetting(true);
    setGenerateMsg(null);
    await resetEventData(code);
    const count = event.settings.maxPlayers ?? 40;
    const drafts = generateFakePlayers(count, event);
    await seedFakePlayers(code, drafts);
    const [allPlayers, allGames] = await Promise.all([getPlayers(code), getGames(code)]);
    const proposals = generateTables(allPlayers, allGames, [], event.settings.bufferMinutes, event.settings.physicalTables, 1, event.settings.breaks);
    await saveProposedTables(code, proposals as any);
    setResetting(false);
    setGenerateMsg(`✓ Se reseteó el evento y se crearon ${count} jugadores de prueba nuevos con ${proposals.length} mesa${proposals.length === 1 ? '' : 's'}.`);

  }

  async function handleStatusChange(status: MeepleEvent['status']) {
    await updateEventStatus(code, status);
    setEvent((ev) => ev ? { ...ev, status } : ev);
  }

  function handleDraftChange(key: keyof MeepleEvent['settings'], value: unknown) {
    setSettingsDraft((d) => d ? { ...d, [key]: value } : d);
  }

  async function handleSaveSettings() {
    if (!event || !settingsDraft) return;
    setSavingSettings(true);
    const mapUrl = mapUrlDraft.trim() || null;
    await Promise.all([
      updateEventSettings(code, settingsDraft),
      updateEventDetails(code, { mapUrl }),
    ]);
    setEvent((ev) => ev ? { ...ev, settings: settingsDraft, mapUrl } : ev);
    setSavingSettings(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  function copyShareUrl() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyAdminUrl() {
    navigator.clipboard.writeText(adminUrl);
    setAdminCopied(true);
    setTimeout(() => setAdminCopied(false), 2000);
  }

  if (authorized === false) return <div className='p-8 text-center text-red-500'>Acceso denegado.</div>;
  if (!event || !settingsDraft) return <div className='p-8 text-center'>Cargando...</div>;

  const confirmedCount = tables.filter((t) => ['confirmed', 'in-progress'].includes(t.status)).length;
  const proposedCount = tables.filter((t) => t.status === 'proposed').length;

  return (
    <main className='max-w-2xl mx-auto px-4 py-10 space-y-6'>
      <div>
        <h1 className='text-2xl font-bold'>{event.name}</h1>
        <p className='text-gray-400 text-sm'>{event.date} · {event.location}</p>
        <p className='text-xs text-gray-500 mt-1'>Código: <span className='font-mono text-indigo-400'>{code}</span></p>
      </div>

      {/* Admin access — losing this link means losing access, since there's no login/recovery */}
      <section className='border border-amber-800 bg-amber-950/30 rounded-xl p-4 space-y-2'>
        <h2 className='font-semibold text-sm'>🔑 Tu acceso de administrador</h2>
        <div className='flex gap-2'>
          <input readOnly value={adminUrl}
            className='flex-1 border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-300'
            onFocus={(e) => e.target.select()} />
          <button onClick={copyAdminUrl}
            className='bg-amber-700 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-amber-600 shrink-0'>
            {adminCopied ? '✓ Copiado' : 'Copiar'}
          </button>
          <button disabled title='Próximamente: enviarte este link por email'
            className='border border-gray-700 text-gray-500 rounded-lg px-4 py-1.5 text-sm font-medium shrink-0 cursor-not-allowed'>
            📧 Enviar
          </button>
        </div>
        <p className='text-xs text-amber-500/80'>⚠️ Guardá este link — sin él no hay forma de recuperar el acceso. También quedó guardado en “Mis eventos” en este navegador.</p>
      </section>

      {/* Share link */}
      <section className='border border-indigo-800 bg-indigo-950/40 rounded-xl p-4 space-y-2'>
        <h2 className='font-semibold text-sm'>🔗 Compartir con jugadores</h2>
        <div className='flex gap-2'>
          <input readOnly value={shareUrl}
            className='flex-1 border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm font-mono text-gray-300'
            onFocus={(e) => e.target.select()} />
          <button onClick={copyShareUrl}
            className='bg-indigo-600 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-indigo-700 shrink-0'>
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
        </div>
        <p className='text-xs text-gray-500'>O compartí el código <span className='font-mono text-indigo-400'>{code}</span> para que se anoten desde la portada.</p>
      </section>

      {/* Stats */}
      <div className='grid grid-cols-3 gap-3'>
        <StatCard label='Inscriptos' value={players.length} sub={event.settings.maxPlayers ? `/ ${event.settings.maxPlayers}` : ''} />
        <StatCard label='Mesas prop.' value={proposedCount} />
        <StatCard label='Mesas conf.' value={confirmedCount} />
      </div>

      {/* Status */}
      <section className='border border-gray-700 rounded-xl p-4 space-y-2'>
        <h2 className='font-semibold'>Estado del evento</h2>
        <div className='flex gap-2 flex-wrap'>
          {(['setup', 'open', 'live', 'closed'] as MeepleEvent['status'][]).map((s) => (
            <button key={s} onClick={() => handleStatusChange(s)}
              className={`px-3 py-1 rounded-full text-sm border ${event.status === s ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-700 text-gray-300 hover:bg-gray-800'}`}>
              {s}
            </button>
          ))}
        </div>
      </section>

      {/* Settings */}
      <section className='border border-gray-700 rounded-xl p-4 space-y-3'>
        <h2 className='font-semibold'>Configuración</h2>
        <div>
          <label className='text-xs text-gray-400 block mb-1'>Link de Google Maps</label>
          <input type='url' placeholder='https://maps.app.goo.gl/...'
            className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
            value={mapUrlDraft} onChange={(e) => setMapUrlDraft(e.target.value)} />
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div>
            <label className='text-xs text-gray-400 block mb-1'>Capacidad máxima</label>
            <input type='number' min={1} placeholder='Sin límite'
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
              value={settingsDraft.maxPlayers ?? ''} onFocus={(e) => e.target.select()}
              onChange={(e) => handleDraftChange('maxPlayers', e.target.value ? +e.target.value : null)} />
          </div>
          <div>
            <label className='text-xs text-gray-400 block mb-1'>Máx. juegos por jugador</label>
            <input type='number' min={1} placeholder='Sin límite'
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
              value={settingsDraft.maxGamesPerPlayer ?? ''} onFocus={(e) => e.target.select()}
              onChange={(e) => handleDraftChange('maxGamesPerPlayer', e.target.value ? +e.target.value : null)} />
          </div>
          <div>
            <label className='text-xs text-gray-400 block mb-1'>Buffer entre mesas (min)</label>
            <input type='number' min={0}
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
              value={settingsDraft.bufferMinutes} onFocus={(e) => e.target.select()}
              onChange={(e) => handleDraftChange('bufferMinutes', +e.target.value)} />
          </div>
          <div>
            <label className='text-xs text-gray-400 block mb-1'>Mesas físicas disponibles</label>
            <input type='number' min={1} placeholder='Sin límite'
              className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
              value={settingsDraft.physicalTables ?? ''} onFocus={(e) => e.target.select()}
              onChange={(e) => handleDraftChange('physicalTables', e.target.value ? +e.target.value : null)} />
          </div>
          <div className='flex items-center gap-2 pt-4'>
            <input type='checkbox' id='autoGen' checked={settingsDraft.autoGenerate}
              onChange={(e) => handleDraftChange('autoGenerate', e.target.checked)} />
            <label htmlFor='autoGen' className='text-sm'>Auto-generar mesas</label>
          </div>
          <div className='flex items-center gap-2 pt-4'>
            <input type='checkbox' id='phoneReq' checked={settingsDraft.phoneRequired}
              onChange={(e) => handleDraftChange('phoneRequired', e.target.checked)} />
            <label htmlFor='phoneReq' className='text-sm'>Teléfono obligatorio</label>
          </div>
        </div>

        <div className='border-t border-gray-800 pt-3 space-y-2'>
          <div className='flex items-center justify-between'>
            <p className='text-sm font-medium'>Descansos programados</p>
            <button onClick={() => handleDraftChange('breaks', [...settingsDraft.breaks, { label: 'Almuerzo', start: '13:00', end: '14:00' }])}
              className='text-xs border border-gray-700 rounded-lg px-2 py-1 hover:bg-gray-800'>
              + Agregar descanso
            </button>
          </div>
          <p className='text-xs text-gray-500'>Ningún juego se agenda durante estos horarios (almuerzo, cena, cierre, etc.). Se muestran en la grilla.</p>
          {settingsDraft.breaks.map((b, i) => (
            <div key={i} className='grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end'>
              <div>
                <label className='text-xs text-gray-400 block mb-1'>Nombre</label>
                <input type='text' value={b.label}
                  className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
                  onChange={(e) => handleDraftChange('breaks', settingsDraft.breaks.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))} />
              </div>
              <div>
                <label className='text-xs text-gray-400 block mb-1'>Desde</label>
                <input type='time' value={b.start}
                  className='border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
                  onChange={(e) => handleDraftChange('breaks', settingsDraft.breaks.map((x, xi) => xi === i ? { ...x, start: e.target.value } : x))} />
              </div>
              <div>
                <label className='text-xs text-gray-400 block mb-1'>Hasta</label>
                <input type='time' value={b.end}
                  className='border border-gray-700 bg-gray-900 rounded-lg px-3 py-1.5 text-sm'
                  onChange={(e) => handleDraftChange('breaks', settingsDraft.breaks.map((x, xi) => xi === i ? { ...x, end: e.target.value } : x))} />
              </div>
              <button onClick={() => handleDraftChange('breaks', settingsDraft.breaks.filter((_, xi) => xi !== i))}
                className='text-red-400 hover:text-red-300 text-xs border border-gray-700 rounded-lg px-2 py-1.5'>
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className='flex items-center gap-3 pt-1'>
          <button onClick={handleSaveSettings} disabled={savingSettings}
            className='bg-indigo-600 text-white rounded-lg px-5 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50'>
            {savingSettings ? 'Guardando...' : '💾 Guardar configuración'}
          </button>
          {savedFlash && <span className='text-green-400 text-sm'>✓ Guardado</span>}
        </div>
      </section>

      {/* Actions */}
      <div className='flex gap-3 flex-wrap items-center'>
        <button onClick={handleGenerate} disabled={generating}
          className='bg-indigo-600 text-white rounded-xl px-5 py-2 font-semibold hover:bg-indigo-700 disabled:opacity-50'>
          {generating ? 'Generando...' : '⚡ Generar mesas'}
        </button>
        <Link href={`/admin/${code}/${adminToken}/tables`} className='border border-gray-700 rounded-xl px-5 py-2 font-medium hover:bg-gray-800'>
          🛠️ Gestionar mesas →
        </Link>
        <Link href={`/admin/${code}/${adminToken}/players`} className='border border-gray-700 rounded-xl px-5 py-2 font-medium hover:bg-gray-800'>
          Ver jugadores →
        </Link>
        <Link href={`/event/${code}/board`} target='_blank' className='border border-gray-700 rounded-xl px-5 py-2 font-medium hover:bg-gray-800'>
          Tablero 📺
        </Link>
        <button onClick={() => setShowQr((v) => !v)}
          className='border border-gray-700 rounded-xl px-5 py-2 font-medium hover:bg-gray-800'>
          📱 QR de la grilla
        </button>
      </div>
      {showQr && boardUrl && (
        <div className='flex flex-col items-center gap-2 border border-gray-700 rounded-xl p-4 w-fit'>
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(boardUrl)}`}
            alt='QR hacia la grilla del evento' width={220} height={220} className='rounded-lg bg-white p-2' />
          <p className='text-xs text-gray-500'>Escaneá para ver la grilla en vivo</p>
        </div>
      )}
      {generating && (
        <div className='flex items-center gap-2 rounded-xl border border-indigo-700 bg-indigo-950/40 px-4 py-3 text-sm text-indigo-300'>
          <span className='inline-block h-3.5 w-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin' />
          Generando mesas... esto puede tardar unos segundos con muchos jugadores.
        </div>
      )}
      {generateMsg && (
        <div className={'flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ' +
          (generateMsg.startsWith('✓') ? 'border-green-700 bg-green-950/40 text-green-300' : 'border-amber-700 bg-amber-950/40 text-amber-300')}>
          <span>{generateMsg}</span>
          <button onClick={() => setGenerateMsg(null)} className='shrink-0 opacity-60 hover:opacity-100'>✕</button>
        </div>
      )}

      {/* Debug / demo */}
      <section className='border border-dashed border-amber-700 rounded-xl p-4'>
        <h2 className='font-semibold text-amber-400 text-sm mb-1'>🧪 Modo demo</h2>
        <p className='text-xs text-gray-500 mb-3'>Genera jugadores de prueba con juegos y votos al azar hasta completar la capacidad máxima configurada (40 si no hay límite), y propone mesas.</p>
        <div className='flex gap-3 flex-wrap'>
          <button onClick={handleSeedFakeData} disabled={seeding || resetting}
            className='bg-amber-700 text-white rounded-xl px-5 py-2 font-semibold hover:bg-amber-600 disabled:opacity-50'>
            {seeding ? 'Generando datos...' : '🧪 Generar jugadores de prueba'}
          </button>
          <button onClick={handleResetAndSeed} disabled={seeding || resetting}
            className='border border-red-700 text-red-400 rounded-xl px-5 py-2 font-semibold hover:bg-red-950 disabled:opacity-50'>
            {resetting ? 'Reseteando...' : '🔄 Resetear y regenerar'}
          </button>
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className='border border-gray-700 rounded-xl p-3 text-center'>
      <p className='text-2xl font-bold'>{value}{sub && <span className='text-sm text-gray-500 font-normal'> {sub}</span>}</p>
      <p className='text-xs text-gray-400'>{label}</p>
    </div>
  );
}
