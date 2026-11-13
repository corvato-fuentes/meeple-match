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
  paymentAlias?: string | null; // the alias to transfer to, on its own so it can be shown big and copied; paymentInfo has the rest
  // With payment required, lets people register WITHOUT the receipt as "indecisos": they can vote and add games but get no
  // tables and don't count towards maxPlayers until they send the receipt (or an organizer confirms them). Off when missing.
  flexibleRegistration?: boolean;
  registrationBannerUrl: string | null; // custom banner image shown to players on the registration screen
  // Shown in "Explorar eventos" on the home page (name, day, hours, place, how many are in). On when missing; off = only with the code.
  listed?: boolean;
}

/**
 * Where the event's pin goes on the map of "Explorar eventos". Worked out by the server from the Google Maps link or, failing that,
 * from the place text, and kept here. `key` says what it was worked out from (see geoKeyOf): if the link or the place changes, it
 * is worked out again. `failed` means it was tried and nothing was found.
 */
export type EventGeo = { key: string } & ({ lat: number; lng: number } | { failed: true });

export interface MeepleEvent {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mapUrl: string | null;
  settings: EventSettings;
  geo?: EventGeo;
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
  // 'tentative' = registered without the receipt (flexible registration): no tables, not counted towards the maximum.
  // Missing or 'confirmed' = a full registration, which is what everyone had before this existed.
  registrationStatus?: 'confirmed' | 'tentative';
  // What an organizer decided about the receipt: 'approved' or 'rejected' (the player is asked to send a new one). Missing
  // = not reviewed yet (or no receipt). A new receipt resets it.
  paymentReview?: 'approved' | 'rejected' | null;
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
  explainerId: string; // plays at the table too, unless they chose to only explain (see `explainerPlays`)
  playerIds: string[]; // accepted/joined players so far — the confirmed roster once status becomes 'confirmed'
  // The explainer chose to ONLY explain: they are not in `playerIds` (no seat is taken for them) and the table holds their time
  // just for the explanation, from the start until `explainEndTime`; after that they are free for other tables. Missing or true =
  // the explainer plays as well, which is how every table works unless the explainer says otherwise. Whoever takes over the
  // explaining later (the explainer left) is always someone seated, so these go back to the default (see asPlayingExplainer).
  explainerPlays?: boolean;
  explainEndTime?: string | null;
  status: TableStatus;
  isManuallyEdited: boolean;
  batchNumber: number;
  // Only meaningful while status is 'recommended' and postedByOwner is falsy: everyone the
  // algorithm offered a seat to. Shrinks as people accept (→ playerIds) or reject (→ rejectedIds).
  candidateIds?: string[];
  // Players who rejected THIS specific recommended table — their underlying vote isn't touched,
  // they just won't be re-offered this exact table instance again.
  rejectedIds?: string[];
  // Explainer-first offers: the table is first offered ONLY to the people who can explain the game, all at once. While
  // `awaitingExplainer` is true `candidateIds` holds exactly those people, `explainerId` is just a placeholder (one of
  // them) and everyone else the table was built for waits in `queuedIds` (they see it, but aren't asked yet). The first
  // of them to accept becomes `explainerId` and takes a seat; the rest of the pool and the queue then become the normal
  // candidates. If all of them decline (or can no longer do it) the table is cancelled.
  // Tables created before this existed have none of these fields and keep working as plain offers.
  awaitingExplainer?: boolean;
  queuedIds?: string[];
  // True for a table the game's owner posted directly ("I'm bringing this, join me at 4pm")
  // instead of one the algorithm assembled from votes — players join directly, no candidate pool.
  postedByOwner?: boolean;
  // Set when a table that was still waiting for players was cancelled by the system itself (nobody left to explain it,
  // everyone who accepted left, the owner's own table took its place…). It never got confirmed and nobody cancelled it:
  // the admin's table list doesn't show it as "cancelada". That state is for tables the admin cancels or confirmed ones.
  dissolved?: boolean;
}

// Derived — never stored in Firestore
export interface TimeWindow {
  start: string; // "HH:MM"
  end: string;
}
