'use client';
import { useEffect, useState } from 'react';
import HomeEventCards from '@/components/home/HomeEventCards';
import JoinPanel from '@/components/home/JoinPanel';
import OrganizePanel from '@/components/home/OrganizePanel';

type View = 'home' | 'join' | 'organize';

/** A big choice on the first screen. */
function Choice({ icon, title, hint, onClick }: { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className='w-full text-left border border-gray-700 bg-gray-800 rounded-2xl p-5 hover:bg-gray-700/60 transition-colors flex items-center gap-4'>
      <span className='text-3xl' aria-hidden='true'>{icon}</span>
      <span className='min-w-0'>
        <span className='block text-lg font-semibold'>{title}</span>
        <span className='block text-sm text-gray-400'>{hint}</span>
      </span>
      <span className='ml-auto text-gray-500' aria-hidden='true'>→</span>
    </button>
  );
}

export default function LandingPage() {
  const [view, setView] = useState<View>('home');
  const [openAdmin, setOpenAdmin] = useState(false);

  // Coming from an organizer's ticket ("/#admin"): straight to where the admin link is pasted
  useEffect(() => {
    queueMicrotask(() => {
      if (window.location.hash === '#admin') { setOpenAdmin(true); setView('organize'); }
    });
  }, []);

  return (
    <main className='max-w-lg mx-auto px-4 py-12 space-y-8 text-center'>
      <div>
        <h1 className='text-3xl font-bold mb-2'>Meeple Loop 🎲</h1>
        <p className='text-gray-400'>Organizá o unite a un evento de juegos de mesa</p>
      </div>

      {view === 'home' && (
        <>
          <HomeEventCards />
          <section className='space-y-3'>
            <Choice icon='🎲' title='Unirme a un evento' hint='Con el código de un evento o a un intercambio' onClick={() => setView('join')} />
            <Choice icon='🛠️' title='Organizar un evento' hint='Creá el tuyo o entrá al que ya organizás' onClick={() => setView('organize')} />
          </section>
        </>
      )}

      {view !== 'home' && (
        <section className='space-y-4'>
          <div className='flex items-center gap-3 text-left'>
            <button onClick={() => { setView('home'); setOpenAdmin(false); }} className='text-gray-500 hover:text-gray-300'>←</button>
            <h2 className='text-xl font-semibold'>{view === 'join' ? '🎲 Unirme a un evento' : '🛠️ Organizar un evento'}</h2>
          </div>
          {view === 'join' ? <JoinPanel /> : <OrganizePanel openAdmin={openAdmin} />}
        </section>
      )}
    </main>
  );
}
