import { useCallback, useEffect, useRef, useState } from 'react';
import { updatePlayerWishlist } from '@/lib/firestore';
import { runTableGeneration } from '@/lib/tableGeneration';
import type { MeepleEvent, Player } from '@/lib/types';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface WishlistData {
  interests: Player['interests'];
  canExplain: string[];
  playedGameIds: string[];
  repeatGameIds: string[];
}

// The vote itself is saved shortly after the last tap. Regenerating tables only ever ADDS
// candidates (it never takes them back), so it waits for the player to stop changing things —
// otherwise a "yes" they flip back a second later could already have put them on a table.
const SAVE_DELAY_MS = 800;
const REGENERATE_DELAY_MS = 3000;

/**
 * Saves the player's votes / knowledge levels automatically whenever they change, then asks the
 * scheduler to look for tables once they've settled. `data` must be null until the player has
 * loaded — the first non-null value is the baseline and is never written back.
 */
export function useAutoSaveWishlist(code: string, playerId: string | undefined, event: MeepleEvent | null, data: WishlistData | null) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  const dataRef = useRef(data);
  const eventRef = useRef(event);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const baselineRef = useRef<string | null>(null);
  const savedRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const serialized = data ? JSON.stringify(data) : null;

  // Kept current from an effect (declared first, so it runs before the others) rather than during render.
  useEffect(() => { dataRef.current = data; eventRef.current = event; });

  const regenerate = useCallback(() => {
    regenTimer.current = null;
    const ev = eventRef.current;
    if (ev) runTableGeneration(code, ev).catch(() => {});
  }, [code]);

  const save = useCallback(async () => {
    saveTimer.current = null;
    const snapshot = dataRef.current;
    if (!snapshot || !playerId || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      await updatePlayerWishlist(code, playerId, snapshot);
      savedRef.current = JSON.stringify(snapshot);
      if (regenTimer.current) clearTimeout(regenTimer.current);
      regenTimer.current = setTimeout(regenerate, REGENERATE_DELAY_MS);
      if (dataRef.current && JSON.stringify(dataRef.current) !== savedRef.current) {
        // Something changed while the write was in flight (a timer that fired meanwhile was skipped
        // by the in-flight guard) — queue another pass instead of claiming everything is stored.
        setStatus('pending');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { void saveRef.current(); }, SAVE_DELAY_MS);
      } else {
        setStatus('saved');
      }
    } catch {
      setStatus('error');
    } finally {
      savingRef.current = false;
    }
  }, [code, playerId, regenerate]);
  useEffect(() => { saveRef.current = save; }, [save]);

  useEffect(() => {
    if (serialized === null) return;
    if (baselineRef.current === null) { baselineRef.current = serialized; savedRef.current = serialized; return; }
    if (serialized === savedRef.current) return;
    setStatus('pending');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY_MS);
  }, [serialized, save]);

  // Leaving the page (or closing the tab) shouldn't lose a vote that was still waiting for its
  // timer, nor skip the table search that was queued behind it.
  useEffect(() => {
    function flush() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void save().then(() => {
          if (regenTimer.current) { clearTimeout(regenTimer.current); regenerate(); }
        });
      } else if (regenTimer.current) {
        clearTimeout(regenTimer.current);
        regenerate();
      }
    }
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [save, regenerate]);

  const retry = useCallback(() => { void save(); }, [save]);

  return { status, retry };
}
