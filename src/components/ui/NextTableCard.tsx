'use client';
import { useEffect, useState } from 'react';
import GameCover from '@/components/ui/GameCover';
import { pickNextTable, formatMinutes, type NextTableKind } from '@/lib/nextTable';
import type { Game, Player, Table } from '@/lib/types';

const STYLE: Record<NextTableKind, { box: string; label: string; badge: string }> = {
  live: { box: 'border-green-600 bg-green-950/30', label: '🟢 En curso ahora', badge: 'text-green-300' },
  soon: { box: 'border-amber-500 bg-amber-950/30', label: '🟡 ¡Ya casi!', badge: 'text-amber-300' },
  later: { box: 'border-indigo-700 bg-indigo-950/30', label: '⏭️ Tu próxima mesa', badge: 'text-indigo-300' },
  future: { box: 'border-indigo-700 bg-indigo-950/30', label: '📅 Tu primera mesa', badge: 'text-indigo-300' },
};

interface Props {
  /** The player's own tables (any status — only confirmed / in-progress ones are considered). */
  myTables: Table[];
  eventDate: string;
  games: Game[];
  players: Player[];
  myId: string;
  /** Physical table number per table id — same numbering as the full schedule. */
  slotByTableId: Map<string, number>;
}

/** Event-day shortcut at the top of the ticket: where to go next and who you'll be playing with. */
export default function NextTableCard({ myTables, eventDate, games, players, myId, slotByTableId }: Props) {
  // Re-evaluated every 30s so the countdown and the live / soon states stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = pickNextTable(myTables, eventDate, now);
  if (!next) return null;

  const { table: t, kind } = next;
  const style = STYLE[kind];
  const game = games.find((g) => g.id === t.gameId);
  const nameOf = (id: string) => (id === myId ? 'Vos' : players.find((p) => p.id === id)?.name ?? 'alguien');
  const brings = game ? (game.ownerPlayerId === myId ? 'Vos' : game.ownerName) : null;
  const mates = t.playerIds.filter((id) => id !== myId).map(nameOf);
  const slot = slotByTableId.get(t.id);

  const when =
    kind === 'live' ? `Termina en ${formatMinutes(next.minutesLeft ?? 0)}`
    : kind === 'future' ? `Arranca a las ${t.startTime}`
    : `Empieza en ${formatMinutes(next.minutesUntilStart ?? 0)}`;

  return (
    <section className={`border-2 rounded-2xl p-4 space-y-3 ${style.box}`} aria-label="Tu próxima mesa">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm font-semibold ${style.badge}`}>{style.label}</p>
        <p className={`text-sm font-semibold ${style.badge}`}>{when}</p>
      </div>
      <div className="flex items-center gap-3">
        <GameCover imageUrl={game?.imageUrl} size="md" />
        <div className="min-w-0">
          <p className="text-lg font-bold leading-snug">{t.gameName}</p>
          <p className="text-sm text-gray-400">{t.startTime}–{t.endTime}</p>
        </div>
        <div className="ml-auto text-right shrink-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">Mesa</p>
          <p className="text-3xl font-bold text-yellow-400 leading-none">{slot != null ? `#${slot}` : '—'}</p>
        </div>
      </div>
      <div className="space-y-0.5 text-sm text-gray-300">
        {brings && <p>📦 Trae: <span className="text-gray-100">{brings}</span></p>}
        {t.explainerId && <p>🎓 Explica: <span className="text-gray-100">{nameOf(t.explainerId)}</span></p>}
        {mates.length > 0 && <p>👥 Jugás con: <span className="text-gray-100">{mates.join(', ')}</span></p>}
      </div>
    </section>
  );
}
