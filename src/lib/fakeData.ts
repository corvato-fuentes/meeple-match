import type { GameComplexity, InterestLevel, MeepleEvent } from './types';
import { toMinutes, toTimeString } from './timeUtils';

const FIRST_NAMES = [
  'Juan', 'Sofía', 'Martín', 'Lucía', 'Nico', 'Valen', 'Fede', 'Cami', 'Tomás', 'Agus',
  'Belu', 'Santi', 'Male', 'Facu', 'Euge', 'Pato', 'Gonza', 'Meli', 'Iván', 'Cande',
  'Rama', 'Flor', 'Pablo', 'Caro', 'Diego', 'Naty', 'Seba', 'Ceci', 'Lean', 'Vero',
  'Ana', 'Bruno', 'Clara', 'Darío', 'Elena', 'Fran', 'Gaby', 'Hugo', 'Inés', 'Javi',
];

const GAME_POOL: Array<{
  name: string; minPlayers: number; maxPlayers: number; durationMinutes: number; complexity: GameComplexity;
}> = [
  { name: 'Catan', minPlayers: 3, maxPlayers: 4, durationMinutes: 90, complexity: 'medium' },
  { name: 'Carcassonne', minPlayers: 2, maxPlayers: 5, durationMinutes: 45, complexity: 'light' },
  { name: 'Wingspan', minPlayers: 1, maxPlayers: 5, durationMinutes: 70, complexity: 'medium' },
  { name: 'Terraforming Mars', minPlayers: 1, maxPlayers: 5, durationMinutes: 120, complexity: 'heavy' },
  { name: 'Azul', minPlayers: 2, maxPlayers: 4, durationMinutes: 45, complexity: 'light' },
  { name: 'Pandemic', minPlayers: 2, maxPlayers: 4, durationMinutes: 45, complexity: 'medium' },
  { name: 'Ticket to Ride', minPlayers: 2, maxPlayers: 5, durationMinutes: 60, complexity: 'light' },
  { name: '7 Wonders', minPlayers: 3, maxPlayers: 7, durationMinutes: 30, complexity: 'medium' },
  { name: 'Dixit', minPlayers: 3, maxPlayers: 6, durationMinutes: 30, complexity: 'light' },
  { name: 'Gloomhaven', minPlayers: 1, maxPlayers: 4, durationMinutes: 120, complexity: 'heavy' },
  { name: 'Codenames', minPlayers: 4, maxPlayers: 8, durationMinutes: 15, complexity: 'light' },
  { name: 'Splendor', minPlayers: 2, maxPlayers: 4, durationMinutes: 30, complexity: 'light' },
  { name: 'Root', minPlayers: 2, maxPlayers: 4, durationMinutes: 90, complexity: 'heavy' },
  { name: 'Brass: Birmingham', minPlayers: 2, maxPlayers: 4, durationMinutes: 120, complexity: 'heavy' },
  { name: 'El Grande', minPlayers: 2, maxPlayers: 5, durationMinutes: 90, complexity: 'medium' },
  { name: 'Lord of Waterdeep', minPlayers: 2, maxPlayers: 5, durationMinutes: 60, complexity: 'medium' },
  { name: 'Concordia', minPlayers: 2, maxPlayers: 5, durationMinutes: 100, complexity: 'medium' },
  { name: 'Scythe', minPlayers: 1, maxPlayers: 5, durationMinutes: 90, complexity: 'heavy' },
  { name: 'Puerto Rico', minPlayers: 2, maxPlayers: 5, durationMinutes: 90, complexity: 'heavy' },
  { name: 'Love Letter', minPlayers: 2, maxPlayers: 4, durationMinutes: 20, complexity: 'light' },
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface FakeGameDraft {
  name: string;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  complexity: GameComplexity;
  canExplain: boolean;
}

export interface FakePlayerDraft {
  name: string;
  arrivalTime: string;
  departureTime: string;
  games: FakeGameDraft[];
}

/** Generates plausible player drafts (variable games per player) within the event's time window.
 * Arrival/departure cluster near the start/end (like real attendees) so tables can actually form. */
export function generateFakePlayers(count: number, event: MeepleEvent): FakePlayerDraft[] {
  const startMin = toMinutes(event.startTime);
  const endMin = toMinutes(event.endTime);
  const duration = Math.max(endMin - startMin, 120);
  const names = shuffle(FIRST_NAMES);

  return Array.from({ length: count }, (_, i) => {
    const name = i < names.length ? names[i] : `${names[i % names.length]} ${Math.floor(i / names.length) + 1}`;
    const arrivalMin = startMin + randInt(0, Math.floor(duration * 0.3));
    const minDeparture = Math.min(arrivalMin + 120, endMin);
    const departureMin = Math.max(minDeparture, endMin - randInt(0, Math.floor(duration * 0.3)));
    const numGames = randInt(1, 3);
    const games: FakeGameDraft[] = Array.from({ length: numGames }, () => ({
      ...pick(GAME_POOL),
      canExplain: Math.random() < 0.85,
    }));
    return {
      name,
      arrivalTime: toTimeString(arrivalMin),
      departureTime: toTimeString(departureMin),
      games,
    };
  });
}

/** Random vote distribution used for fake wishlist interests */
export function randomInterest(): InterestLevel {
  const r = Math.random();
  return r < 0.4 ? 'must' : r < 0.75 ? 'casual' : 'no';
}
