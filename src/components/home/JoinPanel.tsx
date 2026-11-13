'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import EventExplorer from './EventExplorer';

/** One way of joining, as a card: what it is, and its field. */
function Option({ icon, title, hint, children }: { icon: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className='border border-gray-700 rounded-2xl p-4 bg-gray-800 text-left space-y-3'>
      <div>
        <h3 className='font-semibold'>{icon} {title}</h3>
        <p className='text-xs text-gray-400 mt-0.5'>{hint}</p>
      </div>
      {children}
    </div>
  );
}

function CodeForm({ placeholder, button, onGo }: { placeholder: string; button: string; onGo: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); const c = code.trim().toUpperCase(); if (c) onGo(c); }} className='flex gap-2'>
      <input className='flex-1 min-w-0 border border-gray-700 bg-gray-900 rounded-lg px-3 py-2 text-center tracking-widest uppercase font-mono'
        value={code} onChange={(e) => setCode(e.target.value)} placeholder={placeholder} maxLength={8} autoComplete='off' />
      <button type='submit' disabled={!code.trim()}
        className='shrink-0 bg-indigo-600 text-white rounded-lg px-4 py-2 font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed'>
        {button}
      </button>
    </form>
  );
}

/** The ways of joining: an event someone gave you the code of, or an exchange (math trade). */
export default function JoinPanel() {
  const router = useRouter();
  return (
    <div className='space-y-4'>
      <Option icon='🔑' title='Tengo el código de un evento' hint='Te lo pasó el organizador: son 6 letras y números.'>
        <CodeForm placeholder='CÓDIGO' button='Unirme →' onGo={(c) => router.push(`/event/${c}`)} />
      </Option>
      <Option icon='🔎' title='Explorar eventos disponibles' hint='Los eventos abiertos a inscripción, para que veas cuál te queda bien.'>
        <EventExplorer />
      </Option>
      <Option icon='🔁' title='Unirme a un intercambio' hint='Un math trade: intercambio de juegos en cadena entre varios jugadores.'>
        <CodeForm placeholder='CÓDIGO' button='Entrar →' onGo={(c) => router.push(`/mathtrade/${c}`)} />
      </Option>
    </div>
  );
}
