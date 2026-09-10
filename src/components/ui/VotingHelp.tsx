'use client';
import { useState } from 'react';

/** Small "?" button that opens a modal explaining the vote levels and how table scheduling works. */
export default function VotingHelp() {
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
            <h3 className="font-semibold text-gray-100">¿Cómo funciona esto?</h3>
            <ul className="space-y-2 text-gray-300">
              <li><strong>❤️ Quiero:</strong> voto fuerte — el sistema arma mesas priorizando juegos con más "Quiero".</li>
              <li><strong>👍 Me sumo:</strong> te gustaría jugarlo, pero solo entrás si sobra un lugar después de completar la mesa con los "Quiero".</li>
              <li><strong>👎 No:</strong> no te interesa; el juego se oculta de tu lista.</li>
              <li><strong>🎓 Sé explicarlo:</strong> marcalo si conocés las reglas — sin al menos un explicador, esa mesa no se arma. Si marcás esto pero no votás ❤️ ni 👍 en ese juego, no ocupás un lugar en la mesa: solo vas a explicarlo un rato y después quedás libre para jugar otra cosa.</li>
              <li><strong>🔁 Repetir:</strong> si ya te tocó jugarlo, marcalo para poder entrar a una segunda mesa del mismo juego más tarde.</li>
            </ul>
            <p className="text-gray-400">
              Las mesas se recalculan solas cada vez que alguien se inscribe o vota, así que pueden cambiar hasta que el
              organizador confirme una. Una vez confirmada, ya no se toca.
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
