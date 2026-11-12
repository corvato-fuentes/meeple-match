'use client';
import type { ConflictPrompt } from '@/hooks/useScheduleConflict';
import type { Table } from '@/lib/types';

const STATUS_NOTE: Partial<Record<Table['status'], string>> = {
  confirmed: 'confirmada', recommended: 'esperando jugadores', 'in-progress': 'en curso', completed: 'terminó',
};

/** "Dune (14:45–17:30)" for one table, with its state when the prompt has to tell several apart. */
const label = (t: Table, withState: boolean) =>
  `${t.gameName} (${t.startTime}–${t.endTime}${withState && STATUS_NOTE[t.status] ? `, ${STATUS_NOTE[t.status]}` : ''})`;

/**
 * Warns that the table being accepted overlaps one or SEVERAL the player already holds, and lets them settle it right here:
 *  - soft: the others are still waiting for players; the player can leave them and take the new one.
 *  - confirmed: at least one is set; the player can still leave them all and take the new one, knowing others count on them.
 *  - locked: one is underway or already played, so it can't be left ("Entendido").
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
  const { conflicts, incoming } = prompt;
  const many = conflicts.length > 1;
  const first = conflicts[0];
  const list = conflicts.map((c) => label(c, many)).join(', ');
  const staying = many ? 'mis mesas' : first.gameName;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => onChoice(false)}>
      <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-100">⚠️ Horario superpuesto</h3>
        {prompt.kind === 'locked' ? (
          <>
            <p className="text-xs text-gray-400">
              {many ? (
                <>Se superpone con {conflicts.length} mesas tuyas: <strong className="text-gray-300">{list}</strong>. Alguna ya está en curso o terminó, así que no podés tomar esta mesa.</>
              ) : (
                <>La mesa de <strong className="text-gray-300">{first.gameName}</strong> ({first.startTime}–{first.endTime})
                  ya está en curso o terminó, y se superpone con este horario. No podés tomar esta mesa.</>
              )}
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
              {many ? (
                <>
                  Esta mesa se superpone con <strong className="text-gray-300">{conflicts.length} mesas tuyas</strong>: {list}.
                  Si seguís con esta te bajás de todas ellas{prompt.kind === 'confirmed' ? ': en las confirmadas los demás cuentan con vos' : ''}.
                </>
              ) : prompt.kind === 'confirmed' ? (
                <>
                  Ya tenés confirmada la mesa de <strong className="text-gray-300">{first.gameName}</strong> ({first.startTime}–{first.endTime}),
                  que se superpone con este horario. Si seguís con esta mesa te bajás de esa: los demás de esa mesa cuentan con vos.
                </>
              ) : (
                <>
                  Ya estás anotado en la mesa de <strong className="text-gray-300">{first.gameName}</strong> ({first.startTime}–{first.endTime},
                  todavía esperando jugadores), que se superpone con este horario. Si seguís con esta mesa vas a salir de esa.
                </>
              )}
            </p>
            {prompt.asExplainer && (
              <p className="text-xs text-amber-300">
                🎓 Vos explicás {many ? 'alguna de esas mesas' : 'esa mesa'}: si otro de los anotados puede explicarla, la toma; si no, se cancela.
              </p>
            )}
            {/* One above the other, each naming the table it affects: "Rechazar" alone read as the table being left */}
            <div className="flex flex-col gap-2">
              <button onClick={() => onChoice(true)}
                className="w-full bg-indigo-600 rounded-lg py-2.5 px-3 text-xs font-medium hover:bg-indigo-700">
                ✅ Bajarme de {many ? <strong>las {conflicts.length} mesas</strong> : <strong>{first.gameName}</strong>} y aceptar <strong>{incoming.gameName}</strong>
              </button>
              <button onClick={() => (onReject ? onReject() : onChoice(false))}
                className="w-full border border-gray-700 rounded-lg py-2.5 px-3 text-xs font-medium text-gray-300 hover:bg-gray-800">
                {onReject ? <>❌ Rechazar <strong>{incoming.gameName}</strong> y quedarme en <strong>{staying}</strong></> : <>Cancelar y quedarme en <strong>{staying}</strong></>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
