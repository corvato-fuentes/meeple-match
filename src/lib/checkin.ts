// What the ticket's QR code says, and how the check-in screen reads it back. The QR carries the event code and the
// ticket code — the same two things already in the ticket link — in a short text form instead of a URL, so a phone's
// own camera app doesn't try to open anything when someone scans it by accident.

const PREFIX = 'MEEPLELOOP';

export function buildCheckinPayload(eventCode: string, ticketCode: string): string {
  return `${PREFIX}|${eventCode}|${ticketCode}`;
}

/** The event + ticket code inside a scanned QR, or null when the text isn't one of ours. */
export function parseCheckinPayload(text: string): { eventCode: string; ticketCode: string } | null {
  const m = text.trim().match(/^MEEPLELOOP\|([A-Za-z0-9]{3,12})\|([A-Za-z0-9]{3,16})$/);
  return m ? { eventCode: m[1], ticketCode: m[2] } : null;
}
