'use client';
import { useState } from 'react';

/** Small "?" button that explains why "Tus mesas" keeps changing and when it freezes for good. */
export default function TablesHelp() {
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
            <h3 className="font-semibold text-gray-100">¿De dónde salen tus mesas?</h3>
            <p className="text-gray-300">
              Acá vas a ver las mesas que ya confirmaste.
            </p>
            <p className="text-gray-300">
              Cuando votás tus intereses, el algoritmo busca otros inscriptos con los mismos intereses y te propone
              una mesa en un horario en el que coincidan — la vas a encontrar en <strong>Mesas recomendadas</strong>,
              donde podés aceptarla o rechazarla. Una vez que la aceptás, aparece acá como confirmada.
            </p>
            <p className="text-gray-300">
              También podés revisar las mesas que postularon otros inscriptos en <strong>Mesas postuladas</strong> y
              anotarte. Cuando la mesa junta el mínimo de jugadores necesario, también aparece acá como confirmada.
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
