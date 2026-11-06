'use client';
import type { SaveStatus } from '@/hooks/useAutoSaveWishlist';

/** Small floating indicator for autosave. Stays out of the way: nothing shows until the first change. */
export default function SaveStatusPill({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === 'idle') return null;
  const base = 'rounded-full px-3 py-1.5 text-xs font-medium shadow-lg shadow-black/40 border';
  return (
    <div className="sticky bottom-4 flex justify-end pt-4 pointer-events-none" role="status" aria-live="polite">
      {status === 'error' ? (
        <button onClick={onRetry} className={`${base} pointer-events-auto bg-red-950 border-red-700 text-red-200 hover:bg-red-900`}>
          ⚠️ No se pudo guardar — reintentar
        </button>
      ) : status === 'saved' ? (
        <span className={`${base} bg-green-950 border-green-800 text-green-300`}>✓ Guardado</span>
      ) : (
        <span className={`${base} bg-gray-900 border-gray-700 text-gray-300`}>💾 Guardando…</span>
      )}
    </div>
  );
}
