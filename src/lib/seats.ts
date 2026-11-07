/** A table needs at least two people: this is a social event, so nobody plays solo even if the game allows it. */
export const MIN_TABLE_SEATS = 2;

/** The minimum number of people that makes a table for this game (the game's own minimum, but never below 2). */
export const minSeats = (game: { minPlayers: number }): number => Math.max(MIN_TABLE_SEATS, game.minPlayers);
