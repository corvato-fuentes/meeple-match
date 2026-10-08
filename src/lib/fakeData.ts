import type { GameComplexity, InterestLevel, MeepleEvent } from './types';
import { toMinutes, toTimeString } from './timeUtils';

const FIRST_NAMES = [
  'Juan', 'Sofía', 'Martín', 'Lucía', 'Nico', 'Valen', 'Fede', 'Cami', 'Tomás', 'Agus',
  'Belu', 'Santi', 'Male', 'Facu', 'Euge', 'Pato', 'Gonza', 'Meli', 'Iván', 'Cande',
  'Rama', 'Flor', 'Pablo', 'Caro', 'Diego', 'Naty', 'Seba', 'Ceci', 'Lean', 'Vero',
  'Ana', 'Bruno', 'Clara', 'Darío', 'Elena', 'Fran', 'Gaby', 'Hugo', 'Inés', 'Javi',
];

const LAST_NAMES = [
  'González', 'Rodríguez', 'Fernández', 'López', 'Martínez', 'Pérez', 'García', 'Sánchez',
  'Romero', 'Suárez', 'Torres', 'Álvarez', 'Ruiz', 'Ramírez', 'Flores', 'Acosta',
  'Benítez', 'Medina', 'Herrera', 'Aguirre', 'Molina', 'Silva', 'Ortiz', 'Núñez',
  'Rojas', 'Castro', 'Ibáñez', 'Vega', 'Gómez', 'Díaz',
];

// Only some players get an alias (nickname) — most just go by their real name, like real registrations
const ALIASES = [
  'El Tanque', 'La Bestia', 'Manos de Tijera', 'El Mago', 'Doble Seis', 'La Sombra',
  'El Estratega', 'Piedra Libre', 'El Rápido', 'La Suerte',
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

// Real BGG ids + box art for the demo games, so demo cards look like real ones (cover + "Ver en
// BGG" link) and duplicates auto-merge by BGG link just like real games do.
const BGG_INFO: Record<string, { id: number; imageUrl: string }> = {
  'Catan': { id: 13, imageUrl: 'https://cf.geekdo-images.com/0XODRpReiZBFUffEcqT5-Q__original/img/oRc0AomWA9ZtFqQDZiZbIyKE1j0=/0x0/filters:format(png)/pic9156909.png' },
  'Carcassonne': { id: 822, imageUrl: 'https://cf.geekdo-images.com/peUgu3A20LRmAXAMyDQfpQ__original/img/bP18m_PYjyFOv1IBGgMOteQUneA=/0x0/filters:format(jpeg)/pic8621446.jpg' },
  'Wingspan': { id: 266192, imageUrl: 'https://cf.geekdo-images.com/yLZJCVLlIx4c7eJEWUNJ7w__original/img/cI782Zis9cT66j2MjSHKJGnFPNw=/0x0/filters:format(jpeg)/pic4458123.jpg' },
  'Terraforming Mars': { id: 167791, imageUrl: 'https://cf.geekdo-images.com/wg9oOLcsKvDesSUdZQ4rxw__original/img/thIqWDnH9utKuoKVEUqveDixprI=/0x0/filters:format(jpeg)/pic3536616.jpg' },
  'Azul': { id: 230802, imageUrl: 'https://cf.geekdo-images.com/aPSHJO0d0XOpQR5X-wJonw__original/img/AkbtYVc6xXJF3c9EUrakklcclKw=/0x0/filters:format(png)/pic6973671.png' },
  'Pandemic': { id: 30549, imageUrl: 'https://cf.geekdo-images.com/S3ybV1LAp-8SnHIXLLjVqA__original/img/IsrvRLpUV1TEyZsO5rC-btXaPz0=/0x0/filters:format(jpeg)/pic1534148.jpg' },
  'Ticket to Ride': { id: 9209, imageUrl: 'https://cf.geekdo-images.com/kdWYkW-7AqG63HhqPL6ekA__original/img/rWF8r4JXXCQQ7QhiWHhmT-rQ3Pc=/0x0/filters:format(jpeg)/pic8937637.jpg' },
  '7 Wonders': { id: 68448, imageUrl: 'https://cf.geekdo-images.com/35h9Za_JvMMMtx_92kT0Jg__original/img/jt70jJDZ1y1FWJs4ZQf5FI8APVY=/0x0/filters:format(jpeg)/pic7149798.jpg' },
  'Dixit': { id: 39856, imageUrl: 'https://cf.geekdo-images.com/J0PlHArkZDJ57H-brXW2Fw__original/img/jt3kFCHJ3HJ2079dMLwipFZqdQg=/0x0/filters:format(jpeg)/pic6738336.jpg' },
  'Gloomhaven': { id: 174430, imageUrl: 'https://cf.geekdo-images.com/sZYp_3BTDGjh2unaZfZmuA__original/img/7d-lj5Gd1e8PFnD97LYFah2c45M=/0x0/filters:format(jpeg)/pic2437871.jpg' },
  'Codenames': { id: 178900, imageUrl: 'https://cf.geekdo-images.com/nC6ifPCDnAItwoKSKXVrnw__original/img/Id-jjIer_61ZbvI2_RVRCeBZFY4=/0x0/filters:format(jpeg)/pic8907965.jpg' },
  'Splendor': { id: 148228, imageUrl: 'https://cf.geekdo-images.com/vNFe4JkhKAERzi4T0Ntwpw__original/img/rqcUdtu_N4v-SpI96XVmpYHnJww=/0x0/filters:format(png)/pic8234167.png' },
  'Root': { id: 237182, imageUrl: 'https://cf.geekdo-images.com/JUAUWaVUzeBgzirhZNmHHw__original/img/E0s2LvtFA1L5YKk-_44D4u2VD2s=/0x0/filters:format(jpeg)/pic4254509.jpg' },
  'Brass: Birmingham': { id: 224517, imageUrl: 'https://cf.geekdo-images.com/x3zxjr-Vw5iU4yDPg70Jgw__original/img/FpyxH41Y6_ROoePAilPNEhXnzO8=/0x0/filters:format(jpeg)/pic3490053.jpg' },
  'El Grande': { id: 93, imageUrl: 'https://cf.geekdo-images.com/RRKDHaYtFPHhczkUDcHOmg__original/img/E_QazS4f8ffj6oBcUl3C_VROCEw=/0x0/filters:format(jpeg)/pic7906240.jpg' },
  'Lord of Waterdeep': { id: 110327, imageUrl: 'https://cf.geekdo-images.com/DFZlakC9Lv8cB5Co5z3meA__original/img/zBcLeKy1quxQsUL3IWfXXBMvpqM=/0x0/filters:format(jpeg)/pic9230112.jpg' },
  'Concordia': { id: 124361, imageUrl: 'https://cf.geekdo-images.com/CzwSm8i7tkLz6cBnrILZBg__original/img/BhJ3sB3uk-eSdR1iW4EP3cu0Wi0=/0x0/filters:format(jpeg)/pic3453267.jpg' },
  'Scythe': { id: 169786, imageUrl: 'https://cf.geekdo-images.com/7k_nOxpO9OGIjhLq2BUZdA__original/img/HlDb9F365w0tSP8uD1vf1pfniQE=/0x0/filters:format(jpeg)/pic3163924.jpg' },
  'Puerto Rico': { id: 3076, imageUrl: 'https://cf.geekdo-images.com/QFiIRd2kimaMqTyWsX0aUg__original/img/DOgIp57F7tKZvxeITGAd3e_Q9as=/0x0/filters:format(jpeg)/pic158548.jpg' },
  'Love Letter': { id: 129622, imageUrl: 'https://cf.geekdo-images.com/T1ltXwapFUtghS9A7_tf4g__original/img/xIAzJY7rl-mtPStRZSqnTVsAr8Y=/0x0/filters:format(jpeg)/pic1401448.jpg' },
};

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
  bggUrl: string | null;
  imageUrl: string | null;
  canExplain: boolean;
}

export interface FakePlayerDraft {
  name: string; // display name: alias if assigned, else "firstName lastName"
  firstName: string;
  lastName: string;
  alias: string | null;
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
  const firstNames = shuffle(FIRST_NAMES);
  const lastNames = shuffle(LAST_NAMES);
  const aliases = shuffle(ALIASES);

  return Array.from({ length: count }, (_, i) => {
    const firstName = i < firstNames.length ? firstNames[i] : `${firstNames[i % firstNames.length]}${Math.floor(i / firstNames.length) + 1}`;
    const lastName = lastNames[i % lastNames.length];
    // Roughly 1 in 4 players goes by an alias instead of their real name, like real registrations
    const alias = Math.random() < 0.25 ? aliases[i % aliases.length] : null;
    const name = alias ?? `${firstName} ${lastName}`;
    const arrivalMin = startMin + randInt(0, Math.floor(duration * 0.3));
    const minDeparture = Math.min(arrivalMin + 120, endMin);
    const departureMin = Math.max(minDeparture, endMin - randInt(0, Math.floor(duration * 0.3)));
    const numGames = Math.random() < 0.15 ? 0 : randInt(1, 3);
    const games: FakeGameDraft[] = Array.from({ length: numGames }, () => {
      const g = pick(GAME_POOL);
      const bgg = BGG_INFO[g.name];
      return {
        ...g,
        bggUrl: bgg ? `https://boardgamegeek.com/boardgame/${bgg.id}` : null,
        imageUrl: bgg?.imageUrl ?? null,
        canExplain: Math.random() < 0.85,
      };
    });
    return {
      name,
      firstName,
      lastName,
      alias,
      arrivalTime: toTimeString(arrivalMin),
      departureTime: toTimeString(departureMin),
      games,
    };
  });
}

/** Random vote distribution used for fake wishlist interests */
export function randomInterest(): InterestLevel {
  const r = Math.random();
  return r < 0.6 ? 'yes' : 'no';
}

/** Bringing a game doesn't guarantee wanting to play it — some players just share it */
export function randomOwnGameInterest(): InterestLevel {
  const r = Math.random();
  return r < 0.85 ? 'yes' : 'no';
}

export interface FakeGameForTables {
  id: string;
  name: string;
  ownerPlayerId: string;
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
}

export interface FakePlayerForTables {
  id: string;
  arrivalTime: string;
  departureTime: string;
  interests: Record<string, InterestLevel>;
}

export interface FakePostulatedTableDraft {
  gameId: string;
  gameName: string;
  explainerId: string;
  startTime: string;
  endTime: string;
  playerIds: string[];
  status: 'recommended' | 'confirmed';
}

/**
 * Simulates the "post a table directly" flow (postTable/joinPostedTable) for demo data: some game
 * owners propose a table at a time that fits their own schedule, then other free, interested
 * players join up — some tables fill to the minimum and auto-confirm, others stay open waiting,
 * mirroring the mix of states a real event actually ends up with.
 */
export function generateFakePostulatedTables(
  players: FakePlayerForTables[],
  games: FakeGameForTables[],
  event: MeepleEvent
): FakePostulatedTableDraft[] {
  const buf = event.settings.bufferMinutes;
  const busy = new Map<string, Array<[number, number]>>();
  const isFree = (playerId: string, start: number, end: number) =>
    (busy.get(playerId) ?? []).every(([s, e]) => e + buf <= start || end + buf <= s);
  const markBusy = (playerId: string, start: number, end: number) => {
    const arr = busy.get(playerId) ?? [];
    arr.push([start, end]);
    busy.set(playerId, arr);
  };
  const playerMap = new Map(players.map((p) => [p.id, p]));

  const drafts: FakePostulatedTableDraft[] = [];
  // Only some owners post their game as a table directly — the rest stay wishlist-only, waiting
  // for the algorithm instead (like a real event, not everyone posts).
  const candidateGames = shuffle(games).filter(() => Math.random() < 0.35);

  for (const game of candidateGames) {
    const owner = playerMap.get(game.ownerPlayerId);
    if (!owner) continue;
    const arrivalMin = toMinutes(owner.arrivalTime);
    const departureMin = toMinutes(owner.departureTime);
    const latestStart = departureMin - game.durationMinutes;
    if (latestStart <= arrivalMin) continue;

    let start = -1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = arrivalMin + randInt(0, latestStart - arrivalMin);
      const rounded = Math.round(candidate / 5) * 5;
      if (isFree(owner.id, rounded, rounded + game.durationMinutes)) { start = rounded; break; }
    }
    if (start < 0) continue;
    const end = start + game.durationMinutes;
    markBusy(owner.id, start, end);

    const playerIds = [owner.id];
    const targetJoiners = randInt(0, game.maxPlayers - 1);
    const candidates = shuffle(players.filter((p) => p.id !== owner.id && isFree(p.id, start, end)));
    for (const candidate of candidates) {
      if (playerIds.length - 1 >= targetJoiners || playerIds.length >= game.maxPlayers) break;
      const wantsToJoin = candidate.interests[game.id] === 'yes' ? 0.8 : 0.15;
      if (Math.random() < wantsToJoin) {
        playerIds.push(candidate.id);
        markBusy(candidate.id, start, end);
      }
    }

    drafts.push({
      gameId: game.id,
      gameName: game.name,
      explainerId: owner.id,
      startTime: toTimeString(start),
      endTime: toTimeString(end),
      playerIds,
      status: playerIds.length >= game.minPlayers ? 'confirmed' : 'recommended',
    });
  }

  return drafts;
}
