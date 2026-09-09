import { adminDb } from './firebaseAdmin';

export interface EmailConfig {
  gmailUser: string;
  gmailAppPassword: string;
}

// Server-only: lives at events/{code}/private/email, locked to `allow read, write: if false` in
// firestore.rules — only reachable via the Admin SDK (which always bypasses security rules).
export async function getEmailConfig(code: string): Promise<EmailConfig | null> {
  const snap = await adminDb.doc(`events/${code}/private/email`).get();
  return snap.exists ? (snap.data() as EmailConfig) : null;
}

export async function setEmailConfig(code: string, config: EmailConfig): Promise<void> {
  await adminDb.doc(`events/${code}/private/email`).set(config);
}
