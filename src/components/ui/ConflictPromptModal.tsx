'use client';
import type { ConflictPrompt } from '@/hooks/useScheduleConflict';

/**
 * Warns that the table being accepted overlaps one the player already holds, and lets them settle it right here:
 *  - soft: the other one is still waiting for players; the player can leave it and take the new one.
 *  - confirmed: the other table is set; the player can still leave it and take the new one, knowing others count on it.
 *  - locked: the other table is underway or already played, so it can't be left ("Entendido").
 * `onReject` is for screens where the table being accepted can also be declined (recommended tables):
 * the popup then offers "Rechazar" next to the accept option instead of a plain "Cancelar".
 * Tapping outside the popup always just closes it, leaving everything as it was.
 */
export default function ConflictPromptModal({
  prompt, onChoice, onReject,
}: {
  prompt: ConflictPrompt | null;
  onChoice: (wantsSwap: boolean) => void;
  onReject?: () => void;
}) {
  if (!prompt) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => onChoice(false)}>
      <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-100">⚠️ Horario superpuesto</h3>
        {prompt.kind === 'locked' ? (
          <>
            <p className="text-xs text-gray-400">
              La mesa de <strong className="text-gray-300">{prompt.conflict.gameName}</strong> ({prompt.conflict.startTime}–{prompt.conflict.endTime})
              ya está en curso o terminó, y se superpone con este horario. No podés tomar esta mesa.
            </p>
            <div className="flex gap-2">
              {onReject && (
                <button onClick={onReject}
                  className="flex-1 border border-gray-700 rounded-lg py-2 text-xs font-medium text-gray-400 hover:bg-gray-800">
                  ❌ Rechazar esta mesa
                </button>
              )}
              <button onClick={() => onChoice(false)}
                className="flex-1 bg-indigo-600 rounded-lg py-2 text-xs font-medium hover:bg-indigo-700">
                Entendido
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-400">
              {prompt.kind === 'confirmed' ? (
                <>
                  Ya tenés confirmada la mesa de <strong className="text-gray-300">{prompt.conflict.gameName}</strong> ({prompt.conflict.startTime}–{prompt.conflict.endTime}),
                  que se superpone con este horario. Si seguís con esta mesa te bajás de esa: los demás de esa mesa cuentan con vos.
                </>
              ) : (
                <>
                  Ya estás anotado en la mesa de <strong className="text-gray-300">{prompt.conflict.gameName}</strong> ({prompt.conflict.startTime}–{prompt.conflict.endTime},
                  todavía esperando jugadores), que se superpone con este horario. Si seguís con esta mesa vas a salir de esa.
                </>
              )}
            </p>
            {prompt.asExplainer && (
              <p className="text-xs text-amber-300">
                🎓 Vos explicás esa mesa: si otro de los anotados puede explicarla, la toma; si no, esa mesa se cancela.
              </p>
            )}
            {/* One above the other, each naming the table it affects: "Rechazar" alone read as the table being left */}
            <div className="flex flex-col gap-2">
              <button onClick={() => onChoice(true)}
                className="w-full bg-indigo-600 rounded-lg py-2.5 px-3 text-xs font-medium hover:bg-indigo-700">
                ✅ Bajarme de <strong>{prompt.conflict.gameName}</strong> y aceptar <strong>{prompt.incoming.gameName}</strong>
              </button>
              <button onClick={() => (onReject ? onReject() : onChoice(false))}
                className="w-full border border-gray-700 rounded-lg py-2.5 px-3 text-xs font-medium text-gray-300 hover:bg-gray-800">
                {onReject ? <>❌ Rechazar <strong>{prompt.incoming.gameName}</strong> y quedarme en <strong>{prompt.conflict.gameName}</strong></> : <>Cancelar y quedarme en <strong>{prompt.conflict.gameName}</strong></>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
