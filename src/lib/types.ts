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
}

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
}

export interface Table {
  id: string;
  tableNumber: number;
  gameId: string;
  gameName: string;
  startTime: string;
  endTime: string;
  explainerId: string;
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
