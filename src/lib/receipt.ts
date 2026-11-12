import { confirmRegistrationWithProof, getEvent, getPlayers } from '@/lib/firestore';
import { uploadPaymentProof } from '@/lib/paymentProof';
import { atCapacity, isTentative } from '@/lib/registration';
import type { Player } from '@/lib/types';

/**
 * Someone who registered as "indeciso" sends the receipt. If the event already has every place taken by confirmed people
 * nothing is saved (`ok: false`): they stay as indeciso, subject to availability, and an organizer can still confirm them.
 * Otherwise the receipt is uploaded, the registration becomes a full one and the organizers are told.
 */
export async function sendReceipt(code: string, player: Pick<Player, 'id' | 'ticketCode' | 'registrationStatus'>, file: File): Promise<{ ok: true; url: string } | { ok: false }> {
  // Someone who already holds a place (just owes the receipt) is not held back by a full event; an "indeciso" is
  if (isTentative(player)) {
    const [event, players] = await Promise.all([getEvent(code), getPlayers(code)]);
    if (event && atCapacity(event.settings, players)) return { ok: false };
  }
  const url = await uploadPaymentProof(code, player.ticketCode, file);
  await confirmRegistrationWithProof(code, player.id, url);
  // The organizers' notice is a courtesy: a failure here doesn't undo the confirmation
  fetch('/api/proof-uploaded', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ticketCode: player.ticketCode }) }).catch(() => {});
  return { ok: true, url };
}
