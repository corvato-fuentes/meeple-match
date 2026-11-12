import type { EventSettings, Player } from './types';

/** Registered without the receipt (flexible registration): can vote and add games, but is not in the tables and holds no place. */
export const isTentative = (p: Pick<Player, 'registrationStatus'>): boolean => p.registrationStatus === 'tentative';

/** Everyone with a full registration — the ones who hold a place, count towards the maximum and are put in tables. */
export const confirmedPlayers = <T extends Pick<Player, 'registrationStatus'>>(players: T[]): T[] => players.filter((p) => !isTentative(p));

export const tentativeCount = (players: Pick<Player, 'registrationStatus'>[]): number => players.filter(isTentative).length;

/** Can people register without the receipt? Only when payment is required and the organizers turned flexible registration on. */
export const flexibleRegistrationOn = (s: Pick<EventSettings, 'paymentRequired' | 'flexibleRegistration'>): boolean =>
  !!s.paymentRequired && !!s.flexibleRegistration;

/**
 * The three ways an event can take registrations, as the admin picks them:
 *  - free: no receipt and no question about whether they will come;
 *  - flexible: receipt required, but people may register as "indeciso" without it;
 *  - strict: receipt required, no receipt no registration.
 * They are stored as the two settings the rest of the app already reads (paymentRequired, flexibleRegistration).
 */
export type RegistrationMode = 'free' | 'flexible' | 'strict';

export function registrationModeOf(s: Pick<EventSettings, 'paymentRequired' | 'flexibleRegistration'>): RegistrationMode {
  if (!s.paymentRequired) return 'free';
  return s.flexibleRegistration ? 'flexible' : 'strict';
}

export function settingsForMode(mode: RegistrationMode): Pick<EventSettings, 'paymentRequired' | 'flexibleRegistration'> {
  return { paymentRequired: mode !== 'free', flexibleRegistration: mode === 'flexible' };
}

/**
 * Where a player stands with the receipt, for an event that asks for one:
 *  - 'not-required': the event doesn't ask for it;
 *  - 'missing': there is none (registered before the event asked for it, or as "indeciso");
 *  - 'rejected': an organizer turned it down and the player was asked for a new one;
 *  - 'sent': there is one, waiting for review or already approved — or an organizer confirmed the payment without a receipt
 *    (paid in person), which settles it just the same.
 */
export type ReceiptState = 'not-required' | 'missing' | 'rejected' | 'sent';

export function receiptStateOf(
  p: Pick<Player, 'paymentProofUrl' | 'paymentReview'>, settings: Pick<EventSettings, 'paymentRequired'>
): ReceiptState {
  if (!settings.paymentRequired) return 'not-required';
  if (p.paymentReview === 'rejected') return 'rejected';
  if (p.paymentReview === 'approved') return 'sent';
  return p.paymentProofUrl ? 'sent' : 'missing';
}

/** Who still owes a receipt: the ones without it and the ones whose receipt was rejected. */
export const owesReceipt = (state: ReceiptState): boolean => state === 'missing' || state === 'rejected';

/** The event has all the places it allows taken by confirmed people. Tentative ones don't take a place. */
export function atCapacity(settings: Pick<EventSettings, 'maxPlayers'>, players: Pick<Player, 'registrationStatus'>[]): boolean {
  return settings.maxPlayers != null && confirmedPlayers(players).length >= settings.maxPlayers;
}
