import { Timestamp } from 'firebase/firestore';

export type MathTradeStatus = 'open' | 'closed' | 'resolved';

export interface MathTradeEvent {
  name: string;
  createdAt: Timestamp;
  status: MathTradeStatus;
}

// Stored separately at /mathtrades/{code}/private/config — mirrors the board-game event's admin token pattern
export interface MathTradeAdminConfig {
  adminToken: string;
}

export interface MathTradeItem {
  id: string;
  name: string;
  description: string | null;
  bggUrl: string | null;
  ownerPlayerId: string;
  ownerName: string;
  wantList: string[]; // other item ids, ordered most- to least-wanted
}

export interface MathTradePlayer {
  id: string;
  name: string;
  ticketCode: string;
  registeredAt: Timestamp;
}

// A closed trade loop: itemIds[i]'s owner gives it away and receives itemIds[i+1] (wrapping around)
export interface MathTradeCycle {
  itemIds: string[];
}

export interface MathTradeResult {
  cycles: MathTradeCycle[];
  unmatchedItemIds: string[];
  resolvedAt: Timestamp;
}
