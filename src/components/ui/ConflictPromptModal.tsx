'use client';
import type { ConflictPrompt } from '@/hooks/useScheduleConflict';

export default function ConflictPromptModal({
  prompt, onChoice,
}: {
  prompt: ConflictPrompt | null;
  onChoice: (wantsSwap: boolean) => void;
}) {
  if (!prompt) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={() => onChoice(false)}>
      <div className="max-w-sm w-full bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}>
        {prompt.kind === 'hard' ? (
          <>
            <h3 className="font-semibold text-gray-100">Horario superpuesto</h3>
            <p className="text-xs text-gray-400">
              Ya tenés la mesa de <strong className="text-gray-300">{prompt.conflict.gameName}</strong> confirmada
              de {prompt.conflict.startTime} a {prompt.conflict.endTime}, que se superpone con este horario.
              Tenés que elegir una de las dos mesas.
            </p>
            <button onClick={() => onChoice(false)}
              className="w-full bg-indigo-600 rounded-lg py-2 text-xs font-medium hover:bg-indigo-700">
              Entendido
            </button>
          </>
        ) : (
          <>
            <h3 className="font-semibold text-gray-100">Horario superpuesto</h3>
            <p className="text-xs text-gray-400">
              Ya estás anotado en la mesa de <strong className="text-gray-300">{prompt.conflict.gameName}</strong> ({prompt.conflict.startTime}–{prompt.conflict.endTime},
              todavía esperando jugadores), que se superpone con este horario. Si confirmás esta mesa vas a salir de esa.
            </p>
            <div className="flex gap-2">
              <button onClick={() => onChoice(false)}
                className="flex-1 border border-gray-700 rounded-lg py-2 text-xs font-medium text-gray-400 hover:bg-gray-800">
                Cancelar
              </button>
              <button onClick={() => onChoice(true)}
                className="flex-1 bg-indigo-600 rounded-lg py-2 text-xs font-medium hover:bg-indigo-700">
                Sí, cambiar de mesa
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
