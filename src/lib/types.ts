import { Timestamp } from "firebase/firestore";

export type EventStatus = "setup" | "open" | "live" | "closed";
export type GameComplexity = "light" | "medium" | "heavy";
export type InterestLevel = "must" | "casual" | "no";
export type TableStatus = "proposed" | "confirmed" | "in-progress" | "completed" | "cancelled";

export interface ScheduledBreak {
  label: string;
  start: string;
  end: string;
}

export interface EventSettings {
  bufferMinutes: number;
  autoGenerate: boolean;
  maxPlayers: number | null;
  maxGamesPerPlayer: number | null;
  phoneRequired: boolean;
  physicalTables: number | null;
  breaks: ScheduledBreak[];
  paymentRequired: boolean;
  paymentInfo: string | null; // account/transfer info shown to players when paymentRequired is true
  autoGenerateFreezeHours: number; // hours before midnight of the event day that auto-triggers stop regenerating; 0 = freeze at midnight
  registrationBannerUrl: string | null; // custom banner image shown to players on the registration screen
}

export interface MeepleEvent {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  mapUrl: string | null;
  status: EventStatus;
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
  repeatGameIds: string[]; // gameIds the player is happy to play again in a second table
  paymentProofUrl: string | null; // Cloudinary secure_url; unguessable path, never linked on any public-facing page
}

export interface Table {
  id: string;
  tableNumber: number;
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string;
  explainerIsPlaying: boolean; // false = "explica y se va": teaches for a short block, isn't in playerIds and doesn't take a seat
  playerIds: string[];
  status: TableStatus;
  isManuallyEdited: boolean;
  batchNumber: number;
}

// Derived — never stored in Firestore
export interface TimeWindow {
  start: string; // "HH:MM"
  end: string;
}
