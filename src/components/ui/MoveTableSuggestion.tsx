'use client';
import { useState } from 'react';
import { suggestMovesForPostedTable } from '@/lib/tableAlgorithm';
import type { Game, MeepleEvent, Player, Table } from '@/lib/types';

/**
 * On a table its owner posted that is still waiting for players: when other times would work for more of the people who
 * voted the game (they keep voting after it is posted), offers to move the table there. Shows nothing when the current time
 * is already as good as it gets. People already anotados have to accept the new time again, and are told so.
 */
export default function MoveTableSuggestion({ table, poster, players, allTables, games, event, onMove }: {
  table: Table;
  poster: Player;
  /** Everyone with a full registration (the people a table is for). */
  players: Player[];
  allTables: Table[];
  games: Game[];
  event: Pick<MeepleEvent, 'startTime' | 'endTime' | 'settings'>;
  onMove: (startTime: string, endTime: string) => Promise<void>;
}) {
  const [moving, setMoving] = useState<string | null>(null);
  if (!table.postedByOwner || table.status !== 'recommended' || table.explainerId !== poster.id) return null;

  const { current, better } = suggestMovesForPostedTable({
    table, poster, players, tables: allTables, bufferMinutes: event.settings.bufferMinutes,
    eventStart: event.startTime, eventEnd: event.endTime,
    gameCopies: games.filter((g) => (g.groupId ?? g.id) === table.gameId).length || 1, physicalTables: event.settings.physicalTables,
  });
  if (better.length === 0) return null;
  const joined = table.playerIds.filter((id) => id !== poster.id).length;

  async function move(start: string, end: string) {
    if (joined > 0 && !confirm(`${joined === 1 ? 'La persona anotada tiene' : `Las ${joined} personas anotadas tienen`} que volver a aceptar el nuevo horario. ¿Mover la mesa a las ${start}?`)) return;
    setMoving(start);
    try {
      await onMove(start, end);
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="mt-2 border border-indigo-800 bg-indigo-950/30 rounded-xl p-2.5 space-y-1.5">
      <p className="text-xs text-indigo-200">
        💡 Hay horarios que les sirven a más interesados
        {current.interested > 0 && <span className="text-gray-400"> (a las {table.startTime} pueden {current.available} de {current.interested})</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {better.map((b) => (
          <button key={b.start} type="button" onClick={() => move(b.start, b.end)} disabled={moving !== null}
            className="text-xs rounded-lg border border-indigo-700 text-indigo-100 px-2.5 py-1 hover:bg-indigo-900/40 disabled:opacity-50">
            {moving === b.start ? 'Moviendo...' : `Mover a las ${b.start} · pueden ${b.available} de ${b.interested}`}
            {b.available * 2 > b.interested && moving !== b.start && <span className="ml-1 text-green-300">· la mayoría</span>}
          </button>
        ))}
      </div>
      {joined > 0 && (
        <p className="text-[11px] text-gray-400">
          {joined === 1 ? 'La persona ya anotada va a tener' : `Las ${joined} personas ya anotadas van a tener`} que aceptar el nuevo horario.
        </p>
      )}
    </div>
  );
}
