'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createEvent, getEvent, verifyAdminToken } from '@/lib/firestore';
import { generateUniqueShortCode } from '@/lib/shortCode';
import { saveMyEvent, parseAdminLink } from '@/lib/myEvents';
import { createMathTradeEvent, generateUniqueMathTradeCode } from '@/lib/mathtradeFirestore';
import TimeWheelPicker from '@/components/ui/TimeWheelPicker';
import { isLocalhostName, listedByDefault } from '@/lib/publicEvents';

type Open = 'event' | 'trade' | 'admin' | null;

// Creating an exchange (math trade) is not available yet: off for everyone, localhost included.
// Set NEXT_PUBLIC_MATH_TRADE_CREATE=1 (e.g. in .env.local) to turn it on while it is being built.
const TRADE_CREATION_ENABLED = process.env.NEXT_PUBLIC_MATH_TRADE_CREATE === '1';

/** One thing an organizer can do, as a card: collapsed it is a title and a button, open it is its form. */
function Card({ icon, title, hint, open, onOpen, onClose, button, disabled, note, children }: {
  icon: string; title: string; hint: string; open: boolean; onOpen: () => void; onClose: () => void;
  button: string; disabled?: boolean; note?: string; children: React.ReactNode;
}) {
  return (
    <div className='border border-gray-700 rounded-2xl p-4 bg-gray-800 text-left space-y-3'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h3 className='font-semibold'>{icon} {title}</h3>
          <p className='text-xs text-gray-400 mt-0.5'>{hint}</p>
          {note && <p className='text-xs text-amber-400 mt-1'>{note}</p>}
        </div>
        {open && <button onClick={onClose} className='shrink-0 text-xs text-gray-500 hover:text-gray-300'>Cancelar</button>}
      </div>
      {open ? children : (
        <button onClick={onOpen} disabled={disabled}
          className='bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed'>
          {button}
        </button>
      )}
    </div>
  );
}

/** What an organizer can do: create an event, create an exchange, or get back into the event they already organize. */
export default function OrganizePanel({ openAdmin = false }: { openAdmin?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(openAdmin ? 'admin' : null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  // Shown in "Explorar eventos" or not. On by default — except when the app runs on localhost, where what gets created is
  // for testing (it is the same database) and should not appear in the public list; the organizer can still tick it.
  const [listed, setListed] = useState(true);
  useEffect(() => {
    queueMicrotask(() => {
      const local = isLocalhostName(window.location.hostname);
      setIsLocalhost(local);
      setListed(listedByDefault(local));
    });
  }, []);

  // ── create an event ────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', date: '', startTime: '10:00', endTime: '18:00', location: '', mapUrl: '' });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const code = await generateUniqueShortCode();
      const adminToken = crypto.randomUUID();
      await createEvent(code, adminToken, {
        ...form,
        mapUrl: form.mapUrl.trim() || null,
        settings: {
          bufferMinutes: 15, maxPlayers: null, maxGamesPerPlayer: null, physicalTables: null, breaks: [],
          paymentRequired: false, paymentInfo: null, paymentAlias: null, flexibleRegistration: false, registrationBannerUrl: null,
          listed,
        },
      });
      saveMyEvent({ code, adminToken, name: form.name, date: form.date });
      router.push(`/admin/${code}/${adminToken}`);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  // ── create an exchange (math trade) ────────────────────────────────────────
  const [tradeName, setTradeName] = useState('');
  const [tradeLoading, setTradeLoading] = useState(false);

  async function handleCreateTrade(e: React.FormEvent) {
    e.preventDefault();
    if (!TRADE_CREATION_ENABLED) return;
    setTradeLoading(true);
    try {
      const code = await generateUniqueMathTradeCode();
      const adminToken = crypto.randomUUID();
      await createMathTradeEvent(code, adminToken, tradeName);
      router.push(`/mathtrade/admin/${code}/${adminToken}`);
    } catch (err) {
      console.error(err);
      setTradeLoading(false);
    }
  }

  // ── get back into an event with the admin link ─────────────────────────────
  const [adminLink, setAdminLink] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);

  async function handleAdminLink(e: React.FormEvent) {
    e.preventDefault();
    setAdminError('');
    const parsed = parseAdminLink(adminLink);
    if (!parsed) { setAdminError('Ese no parece un link de administrador. Tiene que incluir /admin/ y tu código secreto.'); return; }
    setAdminBusy(true);
    try {
      if (!(await verifyAdminToken(parsed.code, parsed.adminToken))) { setAdminError('El link no es válido para ese evento.'); return; }
      const ev = await getEvent(parsed.code);
      saveMyEvent({ code: parsed.code, adminToken: parsed.adminToken, name: ev?.name ?? '', date: ev?.date ?? '' });
      router.push(`/admin/${parsed.code}/${parsed.adminToken}`);
    } catch {
      setAdminError('No se pudo comprobar el link. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setAdminBusy(false);
    }
  }

  const field = 'w-full border border-gray-700 bg-gray-900 rounded-lg px-3 py-2';
  return (
    <div className='space-y-4'>
      <Card icon='➕' title='Crear un evento' hint='Armá tu jornada de juegos: inscripción, mesas y juegos en un solo lugar.'
        open={open === 'event'} onOpen={() => setOpen('event')} onClose={() => setOpen(null)} button='Crear evento →'>
        <form onSubmit={handleCreate} className='space-y-4'>
          <div>
            <label className='block text-sm font-medium mb-1'>Nombre del evento</label>
            <input required className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='Board Game Night — Junio' />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block text-sm font-medium mb-1'>Fecha</label>
              <input type='date' required className={field} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label className='block text-sm font-medium mb-1'>Lugar</label>
              <input className={field} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder='Club, domicilio...' />
            </div>
          </div>
          <div>
            <label className='block text-sm font-medium mb-1'>Link de Google Maps (opcional)</label>
            <input type='url' className={field} value={form.mapUrl} onChange={(e) => setForm({ ...form, mapUrl: e.target.value })} placeholder='https://maps.app.goo.gl/...' />
          </div>
          <label className='flex items-start gap-2 text-sm text-gray-300'>
            <input type='checkbox' className='mt-1' checked={listed} onChange={(e) => setListed(e.target.checked)} />
            <span>
              Mostrar en «Explorar eventos»
              <span className='block text-xs text-gray-500'>
                Aparece en la lista pública del inicio. Si lo desmarcás, solo entra quien tenga el código. Lo podés cambiar después en la configuración.
              </span>
              {isLocalhost && (
                <span className='block text-xs text-amber-400 mt-0.5'>Estás en localhost: viene desmarcado para que un evento de prueba no se publique.</span>
              )}
            </span>
          </label>
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
          <button type='submit' disabled={loading} className='w-full bg-indigo-600 text-white rounded-lg py-3 font-semibold hover:bg-indigo-700 disabled:opacity-50'>
            {loading ? 'Creando...' : 'Crear evento'}
          </button>
        </form>
      </Card>

      <Card icon='🔁' title='Crear un intercambio (Math Trade)' hint='Un intercambio de juegos en cadena entre varios jugadores.'
        note={TRADE_CREATION_ENABLED ? undefined : '🚧 Funcionalidad en desarrollo: todavía no está disponible.'}
        open={open === 'trade'} onOpen={() => setOpen('trade')} onClose={() => setOpen(null)} button='Crear intercambio →' disabled={!TRADE_CREATION_ENABLED}>
        <form onSubmit={handleCreateTrade} className='space-y-3'>
          <div>
            <label className='block text-sm font-medium mb-1'>Nombre del math trade</label>
            <input required className={field} value={tradeName} onChange={(e) => setTradeName(e.target.value)} placeholder='Math Trade — Junio' />
          </div>
          <button type='submit' disabled={tradeLoading} className='w-full bg-emerald-600 text-white rounded-lg py-3 font-semibold hover:bg-emerald-700 disabled:opacity-50'>
            {tradeLoading ? 'Creando...' : 'Crear math trade'}
          </button>
        </form>
      </Card>

      <Card icon='🛠️' title='Ya organizo un evento' hint='Entrá al panel con tu link de administrador. Queda guardado en este teléfono o app.'
        open={open === 'admin'} onOpen={() => setOpen('admin')} onClose={() => setOpen(null)} button='Entrar con mi link →'>
        <form onSubmit={handleAdminLink} className='space-y-2'>
          <input className={field + ' text-sm'} value={adminLink} onChange={(e) => setAdminLink(e.target.value)} placeholder='Pegá acá tu link de administrador' autoComplete='off' />
          {adminError && <p className='text-xs text-red-400'>{adminError}</p>}
          <button type='submit' disabled={!adminLink.trim() || adminBusy}
            className='w-full border border-amber-700 text-amber-300 rounded-lg py-2 text-sm font-semibold hover:bg-amber-950/40 disabled:opacity-50'>
            {adminBusy ? 'Comprobando…' : 'Entrar al panel'}
          </button>
        </form>
      </Card>
    </div>
  );
}
