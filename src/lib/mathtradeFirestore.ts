import {
  doc, collection, getDoc, getDocs, addDoc, updateDoc, setDoc,
  query, where, onSnapshot, writeBatch, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { generateTicketCodeCandidate } from './ticketCode';
import type {
  MathTradeEvent, MathTradeAdminConfig, MathTradeItem, MathTradePlayer, MathTradeResult,
} from './mathtradeTypes';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY3479';

function generateCodeCandidate(): string {
  return Array.from({ length: 6 }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  ).join('');
}

export async function generateUniqueMathTradeCode(): Promise<string> {
  for (let attempts = 0; attempts < 20; attempts++) {
    const code = generateCodeCandidate();
    const snap = await getDoc(doc(db, 'mathtrades', code));
    if (!snap.exists()) return code;
  }
  throw new Error('Could not generate unique math trade code after 20 attempts');
}

// ── Event ─────────────────────────────────────────────────────────────────────

export async function createMathTradeEvent(
  code: string,
  adminToken: string,
  name: string
): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'mathtrades', code), { name, status: 'open', createdAt: serverTimestamp() });
  batch.set(doc(db, 'mathtrades', code, 'private', 'config'), { adminToken });
  await batch.commit();
}

export async function getMathTradeEvent(code: string): Promise<MathTradeEvent | null> {
  const snap = await getDoc(doc(db, 'mathtrades', code));
  return snap.exists() ? (snap.data() as MathTradeEvent) : null;
}

export async function getMathTradeAdminConfig(code: string): Promise<MathTradeAdminConfig | null> {
  const snap = await getDoc(doc(db, 'mathtrades', code, 'private', 'config'));
  return snap.exists() ? (snap.data() as MathTradeAdminConfig) : null;
}

export async function verifyMathTradeAdminToken(code: string, adminToken: string): Promise<boolean> {
  const config = await getMathTradeAdminConfig(code);
  return !!config && config.adminToken === adminToken;
}

export async function updateMathTradeStatus(code: string, status: MathTradeEvent['status']): Promise<void> {
  await updateDoc(doc(db, 'mathtrades', code), { status });
}

// ── Players ───────────────────────────────────────────────────────────────────

export async function generateUniqueMathTradeTicketCode(code: string): Promise<string> {
  const playersRef = collection(db, 'mathtrades', code, 'players');
  for (let attempts = 0; attempts < 20; attempts++) {
    const candidate = generateTicketCodeCandidate();
    const snap = await getDocs(query(playersRef, where('ticketCode', '==', candidate)));
    if (snap.empty) return candidate;
  }
  throw new Error('Could not generate unique ticket code after 20 attempts');
}

export async function addMathTradePlayer(
  code: string,
  player: Omit<MathTradePlayer, 'id' | 'registeredAt'>
): Promise<string> {
  const ref = await addDoc(collection(db, 'mathtrades', code, 'players'), {
    ...player,
    registeredAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getMathTradePlayers(code: string): Promise<MathTradePlayer[]> {
  const snap = await getDocs(
    query(collection(db, 'mathtrades', code, 'players'), orderBy('registeredAt'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MathTradePlayer));
}

export async function getMathTradePlayerByTicketCode(
  code: string,
  ticketCode: string
): Promise<MathTradePlayer | null> {
  const snap = await getDocs(
    query(collection(db, 'mathtrades', code, 'players'), where('ticketCode', '==', ticketCode))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as MathTradePlayer;
}

export function subscribeMathTradePlayers(code: string, cb: (players: MathTradePlayer[]) => void) {
  return onSnapshot(
    query(collection(db, 'mathtrades', code, 'players'), orderBy('registeredAt')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MathTradePlayer)))
  );
}

// ── Items ─────────────────────────────────────────────────────────────────────

export async function addMathTradeItem(code: string, item: Omit<MathTradeItem, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'mathtrades', code, 'items'), item);
  return ref.id;
}

export async function getMathTradeItems(code: string): Promise<MathTradeItem[]> {
  const snap = await getDocs(collection(db, 'mathtrades', code, 'items'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MathTradeItem));
}

export function subscribeMathTradeItems(code: string, cb: (items: MathTradeItem[]) => void) {
  return onSnapshot(collection(db, 'mathtrades', code, 'items'), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MathTradeItem)))
  );
}

export async function updateMathTradeItemWantList(
  code: string,
  itemId: string,
  wantList: string[]
): Promise<void> {
  await updateDoc(doc(db, 'mathtrades', code, 'items', itemId), { wantList });
}

// ── Results ───────────────────────────────────────────────────────────────────

export async function saveMathTradeResult(
  code: string,
  result: Omit<MathTradeResult, 'resolvedAt'>
): Promise<void> {
  await setDoc(doc(db, 'mathtrades', code, 'results', 'latest'), {
    ...result,
    resolvedAt: serverTimestamp(),
  });
}

export async function getMathTradeResult(code: string): Promise<MathTradeResult | null> {
  const snap = await getDoc(doc(db, 'mathtrades', code, 'results', 'latest'));
  return snap.exists() ? (snap.data() as MathTradeResult) : null;
}

export function subscribeMathTradeResult(code: string, cb: (result: MathTradeResult | null) => void) {
  return onSnapshot(doc(db, 'mathtrades', code, 'results', 'latest'), (snap) =>
    cb(snap.exists() ? (snap.data() as MathTradeResult) : null)
  );
}
