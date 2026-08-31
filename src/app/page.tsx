'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createEvent } from '@/lib/firestore';
import { generateUniqueShortCode } from '@/lib/shortCode';
import { getMyEvents, saveMyEvent, removeMyEvent, type SavedEvent } from '@/lib/myEvents';
import { createMathTradeEvent, generateUniqueMathTradeCode } from '@/lib/mathtradeFirestore';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [myEvents, setMyEvents] = useState<SavedEvent[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [showMathTradeForm, setShowMathTradeForm] = useState(false);
  const [mathTradeName, setMathTradeName] = useState('');
  const [mathTradeLoading, setMathTradeLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    date: '',
    startTime: '10:00',
    endTime: '18:00',
    location: '',
    mapUrl: '',
  });

  useEffect(() => {
    setMyEvents(getMyEvents());
    setIsLocalhost(['localhost', '127.0.0.1'].includes(window.location.hostname));
  }, []);

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code) router.push(`/event/${code}`);
  }

  function handleForgetEvent(code: string) {
    removeMyEvent(code);
    setMyEvents(getMyEvents());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const code = await generateUniqueShortCode();
      const adminToken = crypto.randomUUID();
      await createEvent(code, adminToken, {
        ...form,
        mapUrl: form.mapUrl.trim() || null,
        settings: {
          bufferMinutes: 15,
          autoGenerate: true,
          maxPlayers: null,
          maxGamesPerPlayer: null,
          phoneRequired: false,
          physicalTables: null,
          breaks: [],
        },
      });
      saveMyEvent({ code, adminToken, name: form.name, date: form.date });
      router.push(`/admin/${code}/${adminToken}`);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  async function handleCreateMathTrade(e: React.FormEvent) {
    e.preventDefault();
    if (!isLocalhost) return;
    setMathTradeLoading(true);
    try {
      const code = await generateUniqueMathTradeCode();
      const adminToken = crypto.randomUUID();
      await createMathTradeEvent(code, adminToken, mathTradeName);
      router.push(`/mathtrade/admin/${code}/${adminToken}`);
    } catch (err) {
      console.error(err);
      setMathTradeLoading(false);
    }
  }

  return (
    <main className='max-w-lg mx-auto px-4 py-16 space-y-10 text-center'>
      <div>
        <h1 className='text-3xl font-bold mb-2'>Meeple Loop 🎲</h1>
        <p className='text-gray-400'>Organizá o unite a un evento de juegos de mesa</p>
      </div>

      {myEvents.length > 0 && (
        <section className='border border-gray-700 rounded-xl p-5 space-y-3'>
          <h2 className='text-xl font-semibold'>Mis eventos</h2>
          <div className='space-y-2'>
            {myEvents.map((ev) => (
              <div key={ev.code} className='flex items-center justify-between border border-gray-800 rounded-lg px-3 py-2'>
                <div>
                  <p className='font-medium text-sm'>{ev.name || ev.code}</p>
                  <p className='text-xs text-gray-500'>{ev.date} · {ev.code}</p>
                </div>
                <div className='flex items-center gap-3'>
                  <Link href={`/admin/${ev.code}/${ev.adminToken}`} className='text-indigo-400 text-sm hover:underline'>
                    Abrir →
                  </Link>
                  <button onClick={() => handleForgetEvent(ev.code)} title='Olvidar este evento'
                    className='text-gray-600 hover:text-gray-400 text-sm'>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className='border border-gray-700 rounded-xl p-5 space-y-3'>
        <h2 className='text-xl font-semibold'>¿Ya tenés un código de evento?</h2>
        <form onSubmit={handleJoin} className='flex flex-col items-center gap-3'>
          <input
            className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-center tracking-widest uppercase font-mono'
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder='CÓDIGO'
            maxLength={6}
          />
          <button type='submit' disabled={!joinCode.trim()}
            className='bg-indigo-600 text-white rounded-lg px-5 py-2 font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed'>
            Unirme →
          </button>
        </form>
      </section>

      <div className='flex items-center gap-3 text-gray-600 text-xs uppercase tracking-wide'>
        <div className='flex-1 border-t border-gray-800' /> o <div className='flex-1 border-t border-gray-800' />
      </div>

      <section className='space-y-4'>
        {showCreateForm ? (
          <>
            <div className='flex items-center justify-between'>
              <h2 className='text-xl font-semibold'>¿Sos organizador? Creá tu evento</h2>
              <button onClick={() => setShowCreateForm(false)} className='text-gray-500 hover:text-gray-300 text-sm'>
                Cancelar
              </button>
            </div>
            <form onSubmit={handleSubmit} className='space-y-4'>
              <div>
                <label className='block text-sm font-medium mb-1'>Nombre del evento</label>
                <input
                  required
                  className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2'
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder='Board Game Night — Junio'
                />
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className='block text-sm font-medium mb-1'>Fecha</label>
                  <input
                    type='date'
                    required
                    className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2'
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>Lugar</label>
                  <input
                    className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2'
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder='Club, domicilio...'
                  />
                </div>
              </div>
              <div>
                <label className='block text-sm font-medium mb-1'>Link de Google Maps (opcional)</label>
                <input
                  type='url'
                  className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2'
                  value={form.mapUrl}
                  onChange={(e) => setForm({ ...form, mapUrl: e.target.value })}
                  placeholder='https://maps.app.goo.gl/...'
                />
              </div>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className='block text-sm font-medium mb-1'>Desde</label>
                  <TimeWheelPicker value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} />
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>Hasta</label>
                  <TimeWheelPicker value={form.endTime} onChange={(v) => setForm({ ...form, endTime: v })} />
                </div>
              </div>

              <button
                type='submit'
                disabled={loading}
                className='w-full bg-indigo-600 text-white rounded-lg py-3 font-semibold hover:bg-indigo-700 disabled:opacity-50'
              >
                {loading ? 'Creando...' : 'Crear evento'}
              </button>
            </form>
          </>
        ) : (
          <div className='border border-gray-700 rounded-xl p-5 space-y-3'>
            <h2 className='text-xl font-semibold'>¿Sos organizador?</h2>
            <button onClick={() => setShowCreateForm(true)}
              className='bg-indigo-600 text-white rounded-lg px-5 py-2 font-semibold hover:bg-indigo-700'>
              Creá tu evento →
            </button>
          </div>
        )}
      </section>

      <section className='space-y-4'>
        {showMathTradeForm ? (
          <>
            <div className='flex items-center justify-between'>
              <h2 className='text-xl font-semibold'>Crear evento de Math Trade</h2>
              <button onClick={() => setShowMathTradeForm(false)} className='text-gray-500 hover:text-gray-300 text-sm'>
                Cancelar
              </button>
            </div>
            <form onSubmit={handleCreateMathTrade} className='space-y-4'>
              <div>
                <label className='block text-sm font-medium mb-1'>Nombre del math trade</label>
                <input
                  required
                  className='w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2'
                  value={mathTradeName}
                  onChange={(e) => setMathTradeName(e.target.value)}
                  placeholder='Math Trade — Junio'
                />
              </div>
              <button
                type='submit'
                disabled={mathTradeLoading}
                className='w-full bg-emerald-600 text-white rounded-lg py-3 font-semibold hover:bg-emerald-700 disabled:opacity-50'
              >
                {mathTradeLoading ? 'Creando...' : 'Crear math trade'}
              </button>
            </form>
          </>
        ) : (
          <div className='border border-gray-700 rounded-xl p-5 space-y-3'>
            <div className='flex items-center justify-center gap-2'>
              <h2 className='text-xl font-semibold'>Math Trade 🔁</h2>
              {!isLocalhost && (
                <span className='text-xs text-amber-400 border border-amber-800 rounded-full px-2 py-0.5'>Solo en localhost</span>
              )}
            </div>
            <p className='text-gray-400 text-sm'>Organizá un intercambio de juegos en cadena entre varios jugadores.</p>
            <button
              onClick={() => setShowMathTradeForm(true)}
              disabled={!isLocalhost}
              title={isLocalhost ? undefined : 'Por ahora esta función solo está disponible corriendo la app en localhost'}
              className='bg-emerald-600 text-white rounded-lg px-5 py-2 font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600'>
              Crear MathTrade Event →
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
