import type { Game, Table } from './types';
import { roundUp5, toMinutes, toTimeString } from './timeUtils';

/**
 * An explainer can choose to ONLY explain a table: they don't sit down to play (no seat is taken for them, they are not in
 * `playerIds`) and the table holds their time just for the explanation. Everything about that lives here.
 */

/** A table whose explainer only explains (and is already known: while the table waits for an explainer there is none yet). */
export const isExplainOnly = (t: Pick<Table, 'explainerPlays' | 'awaitingExplainer'>): boolean =>
  t.explainerPlays === false && !t.awaitingExplainer;

/** Never shorter than this, so "solo explico" is never a block too short to be real. */
const MIN_BLOCK_MINUTES = 15;
/** Used when the owner of the game didn't say how long setting up and explaining take. */
const DEFAULT_BLOCK_MINUTES = 30;

/** How long an explain-only explainer is held: setting the game up and explaining it, as its owner estimated (30 minutes if not). */
export function explainBlockMinutes(game: Pick<Game, 'setupMinutes' | 'explanationMinutes'> | undefined): number {
  const total = (game?.setupMinutes ?? 0) + (game?.explanationMinutes ?? 0);
  return total > 0 ? Math.max(MIN_BLOCK_MINUTES, roundUp5(total)) : DEFAULT_BLOCK_MINUTES;
}

/** When the explanation block ends for a table starting at `startTime`, never past the end of the table itself. */
export function explainEndFor(table: Pick<Table, 'startTime' | 'endTime'>, game: Pick<Game, 'setupMinutes' | 'explanationMinutes'> | undefined): string {
  return toTimeString(Math.min(toMinutes(table.startTime) + explainBlockMinutes(game), toMinutes(table.endTime)));
}

/**
 * The part of the day this table holds a player: the whole table for someone seated, the explanation block for an explainer who
 * only explains, nothing for anyone else (or if the table is cancelled).
 */
export function occupiedWindow(t: Table, playerId: string): { start: string; end: string } | null {
  if (t.status === 'cancelled') return null;
  if (t.playerIds.includes(playerId)) return { start: t.startTime, end: t.endTime };
  if (t.explainerId === playerId && isExplainOnly(t)) return { start: t.startTime, end: t.explainEndTime ?? t.endTime };
  return null;
}

/** Is the player part of this table — seated, or the explainer who only explains. */
export const isInTable = (t: Table, playerId: string): boolean => occupiedWindow(t, playerId) !== null;

/** The fields that make `playerId` the explainer of a table AND a player in it — what it is for everyone who takes over later. */
export const asPlayingExplainer = (playerId: string) => ({ explainerId: playerId, explainerPlays: true, explainEndTime: null });
