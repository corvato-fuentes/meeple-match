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
              <li><strong>👍 Quiero jugarlo:</strong> el sistema arma una mesa con vos y otros interesados apenas coincidan un horario libre. Vas a poder aceptarla o rechazarla cuando se arme.</li>
              <li><strong>👎 No me interesa:</strong> el juego se oculta de tu lista.</li>
              <li><strong>🎓 Sé explicarlo / 👍 Sé jugarlo / 🆕 Nunca lo jugué:</strong> tu nivel de conocimiento del juego. Sin al menos un explicador, esa mesa no se arma. Si marcás “Sé explicarlo” pero no votás 👍 en ese juego, no ocupás un lugar en la mesa: solo vas a explicarlo un rato y después quedás libre para jugar otra cosa.</li>
              <li><strong>🔁 ¿Otra mesa?:</strong> cuando aceptes una mesa recomendada, te va a preguntar ahí mismo si querés sumarte también a una segunda mesa del mismo juego más adelante.</li>
            </ul>
            <p className="text-gray-400">
              Cuando el sistema encuentra un horario en común para suficiente gente, te va a proponer esa mesa como
              "recomendada" — ahí la aceptás o la rechazás. Una vez que llega al mínimo de aceptados, se confirma.
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
