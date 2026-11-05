import { adminDb } from './firebaseAdmin';

// Server-only (uses firebase-admin, which bypasses Firestore rules). Snapshots live under
// events/{code}/backups, which the client rules never allow, so the only way to read or restore
// them is through the token-checked admin API — and they're wiped together with the event by the
// expiry cron (recursiveDelete), so the personal data they hold expires with it.

export const BACKUP_REASONS = {
  reset: 'Antes de resetear los datos de prueba',
  'delete-player': 'Antes de eliminar un jugador',
  'merge-games': 'Antes de unir juegos',
  'transfer-votes': 'Antes de transferir los votos de un juego',
  'discard-game': 'Antes de descartar un juego',
  'remove-game': 'Antes de que un jugador quitara uno de sus juegos',
  schedule: 'Antes de cambiar el horario del evento',
  'table-edit': 'Antes de editar una mesa',
  manual: 'Copia manual',
  'pre-restore': 'Antes de restaurar otra copia',
} as const;

export type BackupReason = keyof typeof BACKUP_REASONS;

// Reasons that any client may trigger (player flows included); manual/pre-restore need the admin token.
export const AUTO_REASONS = Object.keys(BACKUP_REASONS).filter(
  (r) => r !== 'manual' && r !== 'pre-restore'
) as BackupReason[];

export interface BackupMeta {
  id: string;
  createdAt: number;
  reason: BackupReason;
  counts: { players: number; games: number; tables: number };
}

const MAX_BACKUPS = 20;
const COOLDOWN_MS = 20_000; // several destructive steps in a row share one snapshot instead of flooding
const CHUNK_BYTES = 600_000; // stays well under Firestore's 1 MiB per-document limit
const KINDS = ['players', 'games', 'tables'] as const;
type Kind = (typeof KINDS)[number];

type StoredDoc = { id: string; data: Record<string, unknown> };

function backupsRef(code: string) {
  return adminDb.collection('events').doc(code).collection('backups');
}

function eventFields(data: FirebaseFirestore.DocumentData) {
  return {
    name: data.name, date: data.date, startTime: data.startTime, endTime: data.endTime,
    location: data.location, mapUrl: data.mapUrl ?? null, settings: data.settings,
  };
}

/** Returns the new snapshot's meta, or null when skipped because another one was taken moments ago. */
export async function createBackup(
  code: string,
  reason: BackupReason,
  opts: { force?: boolean } = {}
): Promise<BackupMeta | null> {
  const eventRef = adminDb.collection('events').doc(code);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new Error('Evento inexistente');

  if (!opts.force) {
    const last = await backupsRef(code).orderBy('createdAt', 'desc').limit(1).get();
    const lastAt = last.docs[0]?.data().createdAt as number | undefined;
    if (lastAt && Date.now() - lastAt < COOLDOWN_MS) return null;
  }

  const id = String(Date.now());
  const ref = backupsRef(code).doc(id);
  const counts = { players: 0, games: 0, tables: 0 };

  for (const kind of KINDS) {
    const snap = await eventRef.collection(kind).get();
    counts[kind] = snap.size;
    let chunk: StoredDoc[] = [];
    let bytes = 0;
    let n = 0;
    const flush = async () => {
      if (chunk.length === 0) return;
      await ref.collection('chunks').doc(`${kind}-${n++}`).set({ kind, docs: chunk });
      chunk = [];
      bytes = 0;
    };
    for (const d of snap.docs) {
      const stored: StoredDoc = { id: d.id, data: d.data() };
      const size = JSON.stringify(stored).length;
      if (bytes + size > CHUNK_BYTES) await flush();
      chunk.push(stored);
      bytes += size;
    }
    await flush();
  }

  // Meta goes last so a snapshot that died halfway never shows up in the list.
  const meta: BackupMeta = { id, createdAt: Date.now(), reason, counts };
  await ref.set({ createdAt: meta.createdAt, reason, counts, event: eventFields(eventSnap.data()!) });

  const all = await backupsRef(code).orderBy('createdAt', 'desc').get();
  for (const old of all.docs.slice(MAX_BACKUPS)) await adminDb.recursiveDelete(old.ref);

  return meta;
}

export async function listBackups(code: string): Promise<BackupMeta[]> {
  const snap = await backupsRef(code).orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BackupMeta, 'id'>) }));
}

/**
 * Puts players, games, tables and the event's name/date/schedule/settings back exactly as the
 * snapshot had them — anything created since is removed. Takes a "pre-restore" snapshot first so
 * the restore itself can be undone.
 */
export async function restoreBackup(code: string, id: string): Promise<void> {
  const ref = backupsRef(code).doc(id);
  const metaSnap = await ref.get();
  if (!metaSnap.exists) throw new Error('Copia inexistente');
  const chunks = await ref.collection('chunks').get();

  const byKind: Record<Kind, StoredDoc[]> = { players: [], games: [], tables: [] };
  for (const c of chunks.docs) {
    const { kind, docs } = c.data() as { kind: Kind; docs: StoredDoc[] };
    byKind[kind].push(...docs);
  }

  await createBackup(code, 'pre-restore', { force: true });

  const eventRef = adminDb.collection('events').doc(code);
  const writer = adminDb.bulkWriter();
  const ops: Promise<unknown>[] = []; // surfaces any failed write instead of swallowing it
  for (const kind of KINDS) {
    const keep = new Set(byKind[kind].map((d) => d.id));
    const current = await eventRef.collection(kind).get();
    current.docs.forEach((d) => { if (!keep.has(d.id)) ops.push(writer.delete(d.ref)); });
    byKind[kind].forEach((d) => ops.push(writer.set(eventRef.collection(kind).doc(d.id), d.data)));
  }
  ops.push(writer.update(eventRef, metaSnap.data()!.event));
  await writer.close();
  await Promise.all(ops);
}
