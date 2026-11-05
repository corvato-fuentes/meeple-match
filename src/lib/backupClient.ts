import type { BackupReason } from './eventBackup';

/**
 * Asks the server for a snapshot of the event right before something destructive. With
 * `required` (admin actions) a failed snapshot aborts the change by throwing, so nothing gets
 * overwritten without a way back; player-triggered flows pass `required: false` and carry on.
 */
export async function backupBefore(code: string, reason: BackupReason, opts: { required?: boolean } = {}) {
  const { required = true } = opts;
  try {
    const res = await fetch('/api/backup/snapshot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, reason }),
    });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
  } catch (err) {
    if (required) throw new Error('No se pudo guardar la copia de seguridad previa, así que no se hizo el cambio.');
    console.warn('backup skipped', err);
  }
}
