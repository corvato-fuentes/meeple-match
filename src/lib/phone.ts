import { toWhatsappNumber } from './whatsapp';

// Phone numbers are typed by hand in every format people use ("0351 15 555-1234", "+54 9 351 555 1234",
// "3515551234"…). To show them all the same way, Argentine numbers are reduced to area code + number
// (no leading 0, no "15") and grouped: "351 555-1234", "11 5555-1234", "2966 12-3456".

// Area codes with 3 digits (the other non-"11" ones have 4). Only used to place the space, so a code
// missing from this list just gets the space one digit off — the number itself is always right.
const THREE_DIGIT_AREA_CODES = new Set([
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264', '266', '280', '291', '294', '297', '298', '299',
  '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364', '370', '376', '379', '381', '385', '387', '388',
]);

function groupSubscriber(rest: string): string {
  if (rest.length === 8) return `${rest.slice(0, 4)}-${rest.slice(4)}`; // 11 5555-1234
  if (rest.length === 7) return `${rest.slice(0, 3)}-${rest.slice(3)}`; // 351 555-1234
  return `${rest.slice(0, 2)}-${rest.slice(2)}`;                        // 2966 12-3456
}

export interface DisplayPhone {
  /** Text to show. */
  text: string;
  /** Number for a tel: link (international, with +), or null when the input couldn't be read as a phone number. */
  tel: string | null;
}

export function formatPhoneDisplay(raw: string): DisplayPhone {
  const international = toWhatsappNumber(raw);
  if (!international) return { text: raw.trim(), tel: null };

  if (international.startsWith('549') && international.length === 13) {
    const national = international.slice(3);
    const areaLength = national.startsWith('11') ? 2 : THREE_DIGIT_AREA_CODES.has(national.slice(0, 3)) ? 3 : 4;
    return { text: `${national.slice(0, areaLength)} ${groupSubscriber(national.slice(areaLength))}`, tel: `+${international}` };
  }
  // A foreign number typed with its country code: show it unchanged, as +digits
  return { text: `+${international}`, tel: `+${international}` };
}
