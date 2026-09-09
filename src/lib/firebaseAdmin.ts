import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Server-only: bypasses Firestore rules, so this must never be imported from client code.
// FIREBASE_SERVICE_ACCOUNT_KEY is the full service account JSON (from Firebase Console >
// Project Settings > Service Accounts > Generate new private key), base64-encoded to survive
// .env storage safely.
function getAdminApp(): App {
  if (getApps().length) return getApps()[0];
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!encoded) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY no está configurado');
  const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
  return initializeApp({ credential: cert(serviceAccount) });
}

export const adminDb = getFirestore(getAdminApp());
