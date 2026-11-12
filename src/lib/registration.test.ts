import { describe, expect, it } from 'vitest';
import { atCapacity, confirmedPlayers, flexibleRegistrationOn, isTentative, owesReceipt, receiptStateOf, registrationModeOf, settingsForMode, tentativeCount } from './registration';

const p = (registrationStatus?: 'confirmed' | 'tentative') => ({ registrationStatus });

describe('tentative and confirmed registrations', () => {
  it('a missing status is a full registration, like every registration from before this existed', () => {
    expect(isTentative(p())).toBe(false);
    expect(isTentative(p('confirmed'))).toBe(false);
    expect(isTentative(p('tentative'))).toBe(true);
  });
  it('counts them apart', () => {
    const all = [p(), p('confirmed'), p('tentative'), p('tentative'), p('tentative')];
    expect(confirmedPlayers(all)).toHaveLength(2);
    expect(tentativeCount(all)).toBe(3);
  });
});

describe('flexibleRegistrationOn', () => {
  it('needs payment to be required and the option to be on', () => {
    expect(flexibleRegistrationOn({ paymentRequired: true, flexibleRegistration: true })).toBe(true);
    expect(flexibleRegistrationOn({ paymentRequired: true, flexibleRegistration: false })).toBe(false);
    expect(flexibleRegistrationOn({ paymentRequired: true })).toBe(false);
    expect(flexibleRegistrationOn({ paymentRequired: false, flexibleRegistration: true })).toBe(false);
  });
});

describe('registration modes', () => {
  it('reads the mode from the two stored settings', () => {
    expect(registrationModeOf({ paymentRequired: false })).toBe('free');
    expect(registrationModeOf({ paymentRequired: false, flexibleRegistration: true })).toBe('free'); // flexible means nothing without payment
    expect(registrationModeOf({ paymentRequired: true })).toBe('strict');
    expect(registrationModeOf({ paymentRequired: true, flexibleRegistration: false })).toBe('strict');
    expect(registrationModeOf({ paymentRequired: true, flexibleRegistration: true })).toBe('flexible');
  });
  it('writes the two settings back for each mode, and they read back as the same mode', () => {
    expect(settingsForMode('free')).toEqual({ paymentRequired: false, flexibleRegistration: false });
    expect(settingsForMode('strict')).toEqual({ paymentRequired: true, flexibleRegistration: false });
    expect(settingsForMode('flexible')).toEqual({ paymentRequired: true, flexibleRegistration: true });
    for (const m of ['free', 'strict', 'flexible'] as const) expect(registrationModeOf(settingsForMode(m))).toBe(m);
  });
});

describe('receiptStateOf', () => {
  const on = { paymentRequired: true };
  const proof = 'https://img/receipt.jpg';
  it('an event that does not ask for a receipt has nothing to owe', () => {
    expect(receiptStateOf({ paymentProofUrl: null }, { paymentRequired: false })).toBe('not-required');
    expect(owesReceipt('not-required')).toBe(false);
  });
  it('someone without a receipt owes one: the ones from before the event asked for it, and the indecisos', () => {
    expect(receiptStateOf({ paymentProofUrl: null }, on)).toBe('missing');
    expect(owesReceipt('missing')).toBe(true);
  });
  it('a receipt that is sent, reviewed or not, is not owed; a rejected one is', () => {
    expect(receiptStateOf({ paymentProofUrl: proof }, on)).toBe('sent');
    expect(receiptStateOf({ paymentProofUrl: proof, paymentReview: 'approved' }, on)).toBe('sent');
    expect(receiptStateOf({ paymentProofUrl: proof, paymentReview: 'rejected' }, on)).toBe('rejected');
    expect(owesReceipt('sent')).toBe(false);
    expect(owesReceipt('rejected')).toBe(true);
  });
  it('an organizer confirming the payment settles it even with no receipt (paid in person)', () => {
    expect(receiptStateOf({ paymentProofUrl: null, paymentReview: 'approved' }, on)).toBe('sent');
    expect(owesReceipt(receiptStateOf({ paymentProofUrl: null, paymentReview: 'approved' }, on))).toBe(false);
  });
  it('a rejection counts even if the proof is still stored', () => {
    expect(receiptStateOf({ paymentProofUrl: null, paymentReview: 'rejected' }, on)).toBe('rejected');
  });
});

describe('atCapacity', () => {
  it('only confirmed people take the places: tentative ones do not', () => {
    const all = [p(), p(), p('tentative'), p('tentative'), p('tentative')];
    expect(atCapacity({ maxPlayers: 3 }, all)).toBe(false);
    expect(atCapacity({ maxPlayers: 2 }, all)).toBe(true);
  });
  it('an event without a maximum is never full', () => {
    expect(atCapacity({ maxPlayers: null }, [p(), p(), p()])).toBe(false);
  });
});
