import { Timestamp } from "firebase/firestore";

// Derived from date/startTime/endTime — never stored, see computeEventStatus in timeUtils.ts.
export type EventStatus = "open" | "live" | "closed";
export type GameComplexity = "light" | "medium" | "heavy";
// "yes" = quiero jugarlo (👍), "no" = no me interesa (👎). Absence of a key means "sin votar".
export type InterestLevel = "yes" | "no";
// "recommended" = el algoritmo la armó y está esperando que los candidatos acepten/rechacen
// (o, si postedByOwner, que se sumen jugadores) hasta llegar al mínimo necesario.
export type TableStatus = "recommended" | "confirmed" | "in-progress" | "completed" | "cancelled";

export interface ScheduledBreak {
  label: string;
  start: string;
  end: string;
}

export interface EventSettings {
  bufferMinutes: number;
  maxPlayers: number | null;
  maxGamesPerPlayer: number | null;
  physicalTables: number | null;
  breaks: ScheduledBreak[];
  paymentRequired: boolean;
  paymentInfo: string | null; // account/transfer info shown to players when paymentRequired is true
  registrationBannerUrl: string | null; // custom banner image shown to players on the registration screen
}

export interface MeepleEvent {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mapUrl: string | null;
  settings: EventSettings;
}

// Stored separately at /events/{code}/private/config — never joined into public event reads
export interface EventAdminConfig {
  adminToken: string;
}

export interface Game {
  id: string;
  name: string;
  bggUrl: string | null;
  imageUrl?: string | null; // BGG box-art thumbnail, set when the game was picked from a BGG search
  minPlayers: number;
  maxPlayers: number;
  durationMinutes: number;
  complexity: GameComplexity;
  ownerPlayerId: string;
  ownerName: string;
  // Set when 2+ players independently loaded the same physical game — all copies share this id
  // (the "primary" copy has groupId === its own id). Votes/canExplain/repeat all live on the
  // primary; the scheduling algorithm treats the group as one game with N concurrent copies.
  groupId?: string | null;
  // Extra metadata captured for a future, more precise duration estimate — not used in any
  // calculation yet (durationMinutes above still drives scheduling). The idea: total duration
  // would eventually be setupMinutes + explanationMinutes + (perPlayerMinutes * playerCount).
  perPlayerMinutes?: number | null;
  setupMinutes?: number | null;
  explanationMinutes?: number | null;
  // If false (default), the algorithm only schedules tables for this game where the owner is
  // actually seated — the owner must be there to hand over the physical copy. If true, the owner
  // opted to lend it out: any table can run during the owner's arrival\u2192departure window even
  // without them playing.
  lendable?: boolean;
  // Soft-delete: its owner removed it from "Tus juegos", but players had already voted/known it,
  // so the doc (and everyone's votes on it) stays around for the admin to transfer elsewhere
  // instead of losing that data outright. Hidden from every player-facing list and the algorithm.
  deleted?: boolean;
}

export type DraftGame = Omit<Game, 'id' | 'ownerPlayerId' | 'ownerName'>;

export interface Player {
  id: string;
  name: string; // display name: alias if provided, else "firstName lastName"
  firstName: string;
  lastName: string;
  alias: string | null;
  email: string | null;
  phone: string | null;
  arrivalTime: string;
  departureTime: string;
  registeredAt: Timestamp;
  ticketCode: string;
  bringGameIds: string[];
  interests: Record<string, InterestLevel>;
  canExplain: string[];
  playedGameIds: string[]; // gameIds the player already knows how to play, even if they can't teach it
  repeatGameIds: string[]; // gameIds the player is happy to play again in a second table
  paymentProofUrl: string | null; // Cloudinary secure_url; unguessable path, never linked on any public-facing page
  // Admin-flagged event organizer/staff — surfaced (with contact info) on the ticket-gated
  // Organizadores page so players know who to reach out to, unlike the public roster.
  isOrganizer?: boolean;
  // True only for players created by the "Modo demo" seeder — lets resetEventData wipe just the
  // generated test data and leave real registrations (and the games/tables tied to them) alone.
  isDemoData?: boolean;
}

export interface Table {
  id: string;
  tableNumber: number;
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string; // the explainer always plays at the table — there are no drop-in teachers
  playerIds: string[]; // accepted/joined players so far — the confirmed roster once status becomes 'confirmed'
  status: TableStatus;
  isManuallyEdited: boolean;
  batchNumber: number;
  // Only meaningful while status is 'recommended' and postedByOwner is falsy: everyone the
  // algorithm offered a seat to. Shrinks as people accept (→ playerIds) or reject (→ rejectedIds).
  candidateIds?: string[];
  // Players who rejected THIS specific recommended table — their underlying vote isn't touched,
  // they just won't be re-offered this exact table instance again.
  rejectedIds?: string[];
  // True for a table the game's owner posted directly ("I'm bringing this, join me at 4pm")
  // instead of one the algorithm assembled from votes — players join directly, no candidate pool.
  postedByOwner?: boolean;
}

// Derived — never stored in Firestore
export interface TimeWindow {
  start: string; // "HH:MM"
  end: string;
}
