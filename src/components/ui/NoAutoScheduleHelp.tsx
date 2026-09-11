'use client';
import { useState } from 'react';

/** Small "?" button explaining that opting out of auto-scheduling doesn't stop you from voting. */
export default function NoAutoScheduleHelp() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-600 text-gray-400 text-xs hover:bg-gray-800 hover:text-gray-200 align-middle">
        ?
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => setOpen(false)}>
          <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-100">¿Qué significa esto?</h3>
            <p className="text-gray-300">
              El sistema no te va a armar ninguna mesa automáticamente ni te va a poner como explicador. Pero podés
              seguir votando ❤️/👍 tus juegos como cualquiera.
            </p>
            <p className="text-gray-300">
              Si mostrás interés en un juego, el organizador te puede buscar en el evento para sumarte a mano si hace
              falta completar una mesa.
            </p>
            <button onClick={() => setOpen(false)}
              className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
