import { useEffect, useRef, useState } from 'react';
import { searchBgg, type BggSearchResult } from '@/lib/bgg';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 400;

/**
 * Live BoardGameGeek suggestions for the "add a game" name field. Waits for a short pause in typing, needs at least
 * 3 characters, and shows nothing for a shorter text (derived, not stored). Selecting a suggestion or loading a game
 * to edit changes the name too — set `skipBggSearchRef.current = true` right before doing that so it doesn't trigger
 * a search for the name that was just filled in.
 */
export function useBggSearch(name: string) {
  const [fetched, setFetched] = useState<BggSearchResult[]>([]);
  const [opened, setOpened] = useState(false);
  const [fetching, setFetching] = useState(false);
  const skipBggSearchRef = useRef(false);

  const query = name.trim();
  const enough = query.length >= MIN_CHARS;

  useEffect(() => {
    if (skipBggSearchRef.current) { skipBggSearchRef.current = false; return; }
    if (query.length < MIN_CHARS) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setFetching(true);
      try {
        const results = await searchBgg(query);
        if (cancelled) return;
        setFetched(results);
        setOpened(results.length > 0);
      } catch (err) {
        console.error(err);
        if (!cancelled) setFetched([]);
      } finally {
        if (!cancelled) setFetching(false);
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

  return {
    bggResults: enough ? fetched : [],
    bggOpen: opened && enough,
    bggLoading: fetching && enough,
    setBggOpen: setOpened,
    setBggResults: setFetched,
    skipBggSearchRef,
  };
}
