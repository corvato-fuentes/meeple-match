'use client';
import { useState } from 'react';

/** Small clickable link that explains, on demand, why voting is worth doing even though it's optional. */
export default function WhyVoteHelp() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-xs text-indigo-400 hover:underline mb-3">
        ¿Por qué votar?
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => setOpen(false)}>
          <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-100">¿Por qué votar?</h3>
            <p className="text-gray-300">
              No es obligatorio, pero <strong>ayuda a que todos consigan una mesa</strong> priorizando sus
              preferencias, y evita que alguien se quede sin lugar en ninguna.
            </p>
            <p className="text-gray-300">
              Si preferís no votar, también podés improvisar una mesa el día del evento. Igual, votar o
              proponer te ayuda a <strong>no traer juegos de más sin necesidad</strong>, o a proponer otra
              alternativa si la tuya no entra en la grilla.
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
