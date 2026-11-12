import { adminDb } from './firebaseAdmin';
import { notifyPlayers } from './pushServer';
import { owesReceipt, receiptStateOf } from './registration';

// Server-only. What an organizer decides about a receipt, and the reminders to the people who owe one. Everything the
// players hear is worded here, from the stored event: browsers only say who and what to do.

const players = (code: string) => adminDb.collection(`events/${code}/players`);

async function settingsOf(code: string) {
  const s = (await adminDb.doc(`events/${code}`).get()).data()?.settings ?? {};
  return { paymentRequired: !!s.paymentRequired, flexibleRegistration: !!s.flexibleRegistration };
}

function reminderFor(playerId: string, state: 'missing' | 'rejected') {
  return {
    playerId,
    message: state === 'rejected'
      ? { title: '⚠️ Tu comprobante fue rechazado', body: 'Mandá uno nuevo desde tu ticket para confirmar tu lugar.', tag: `receipt-${playerId}`, ttl: 24 * 3600 }
      : { title: '💸 Falta tu comprobante de pago', body: 'Mandalo desde tu ticket para confirmar tu lugar en el evento.', tag: `receipt-${playerId}`, ttl: 24 * 3600 },
  };
}

/**
 * Approves a receipt (the player holds a full registration) or rejects it: the player is asked for a new one and gets a
 * notification. With flexible registration a rejection also puts them back to "indeciso", since the place was held on a
 * receipt that did not hold up.
 */
export async function reviewReceipt(code: string, playerId: string, decision: 'approve' | 'reject'): Promise<{ notified: boolean }> {
  const ref = players(code).doc(playerId);
  if (!(await ref.get()).exists) throw new Error('unknown player');
  if (decision === 'approve') {
    await ref.update({ paymentReview: 'approved', registrationStatus: 'confirmed' });
    return { notified: false };
  }
  const settings = await settingsOf(code);
  await ref.update({ paymentReview: 'rejected', ...(settings.flexibleRegistration && { registrationStatus: 'tentative' }) });
  const { devices } = await notifyPlayers(code, [reminderFor(playerId, 'rejected')]);
  return { notified: devices > 0 };
}

/**
 * Reminds the people who still owe a receipt — everyone, or just one player. Only when the event asks for a receipt.
 * Returns how many owe one and on how many devices the reminder arrived.
 */
export async function remindReceipts(code: string, onlyPlayerId?: string): Promise<{ owing: number; devices: number }> {
  const settings = await settingsOf(code);
  if (!settings.paymentRequired) return { owing: 0, devices: 0 };
  const docs = onlyPlayerId ? [await players(code).doc(onlyPlayerId).get()] : (await players(code).get()).docs;
  const owing = docs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, state: receiptStateOf({ paymentProofUrl: (d.data()?.paymentProofUrl as string | null) ?? null, paymentReview: d.data()?.paymentReview ?? null }, settings) }))
    .filter((x): x is { id: string; state: 'missing' | 'rejected' } => owesReceipt(x.state));
  const { devices } = await notifyPlayers(code, owing.map((x) => reminderFor(x.id, x.state)));
  return { owing: owing.length, devices };
}
