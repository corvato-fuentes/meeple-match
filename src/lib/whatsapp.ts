// Phone numbers are typed in by hand in whatever format people use ("351 555-1234",
// "0351 15 5551234", "+54 9 351 555 1234"…). WhatsApp links need the bare international number
// (digits only, country code first). Opening a chat with the WRONG person is worse than showing no
// button, so this only answers when the number is unambiguous:
//  - typed with a country code ("+" or "00"): used as typed (Argentine numbers get the mobile "9");
//  - typed without one: accepted only if it can be nothing but an Argentine number — the country
//    where the events happen. Anything else (a foreign number typed without "+") returns null.

export function toWhatsappNumber(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  let international = raw.trim().startsWith('+');
  if (digits.startsWith('00')) {
    digits = digits.slice(2); // 0054… international dialing prefix
    international = true;
  }

  if (international) {
    if (digits.startsWith('54')) return normalizeArgentina(digits.slice(2));
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  // Argentine area codes start with 1, 2 or 3, never 54, so a leading 54 is the country code
  return normalizeArgentina(digits.startsWith('54') ? digits.slice(2) : digits);
}

/**
 * National Argentine number → WhatsApp form (549 + area code + number), or null when it doesn't have
 * the shape of one: 10 digits (area code + number, area code starting with 1, 2 or 3), after dropping
 * the local trunk "0", the mobile "15" and the international mobile "9".
 */
function normalizeArgentina(national: string): string | null {
  let rest = national.startsWith('0') ? national.slice(1) : national;
  if (rest.startsWith('9') && rest.length === 11) rest = rest.slice(1); // already has the mobile marker
  if (rest.length === 12) {
    // area code + "15" + number: drop the 15 (area codes are 2 to 4 digits long)
    for (const at of [2, 3, 4]) {
      if (rest.slice(at, at + 2) === '15') { rest = rest.slice(0, at) + rest.slice(at + 2); break; }
    }
  }
  return rest.length === 10 && /^[123]/.test(rest) ? '549' + rest : null;
}

/** https://wa.me link that opens a chat with the number (WhatsApp app on phones, WhatsApp Web elsewhere). */
export function whatsappLink(phone: string | null | undefined, message?: string): string | null {
  if (!phone) return null;
  const number = toWhatsappNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}
