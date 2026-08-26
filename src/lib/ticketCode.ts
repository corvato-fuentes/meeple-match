import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "./firebase";

// Excludes ambiguous chars: 0/O, 1/I/L, 2/Z, 5/S, 6/G, 8/B
const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479";

export function generateTicketCodeCandidate(): string {
  return Array.from({ length: 6 }, () =>
    ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  ).join("");
}

export async function generateUniqueTicketCode(eventCode: string): Promise<string> {
  const playersRef = collection(db, "events", eventCode, "players");
  for (let attempts = 0; attempts < 20; attempts++) {
    const code = generateTicketCodeCandidate();
    const snap = await getDocs(query(playersRef, where("ticketCode", "==", code)));
    if (snap.empty) return code;
  }
  throw new Error("Could not generate unique ticket code after 20 attempts");
}
