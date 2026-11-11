import { useEffect, useState } from 'react';
import { requestMatchesGame, type GameRequestView } from '@/lib/gameRequests';
import type { Game } from '@/lib/types';

/**
 * How many games people have asked for that nobody brings yet (null until known) — what the "Juegos pedidos" links show.
 * A request whose game somebody already brings (or promised to bring) doesn't count.
 */
export function useOpenGameRequests(code: string, ticket: string | undefined, games: Game[]): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!ticket) return;
    let cancelled = false;
    fetch(`/api/requests?code=${encodeURIComponent(code)}&ticket=${encodeURIComponent(ticket)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { requests?: GameRequestView[] } | null) => {
        if (cancelled || !json?.requests) return;
        setCount(json.requests.filter((r) => !r.claimedBy && !games.some((g) => requestMatchesGame(r, g))).length);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code, ticket, games]);
  return count;
}
