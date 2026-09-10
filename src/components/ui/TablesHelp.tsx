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
            <h3 className="font-semibold text-gray-100">¿Por qué cambian tus mesas?</h3>
            <p className="text-gray-300">
              Las mesas se recalculan solas cada vez que alguien se inscribe o vota, buscando la mejor combinación
              posible con la información disponible en ese momento. Es normal que se muevan hasta último momento.
            </p>
            <p className="text-gray-300">
              A partir de la medianoche del día del evento la grilla se congela y deja de regenerarse sola. Desde ahí,
              solo el organizador puede ajustarla manualmente si hace falta.
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
