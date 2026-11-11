const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Turns the character references BoardGameGeek leaves in its XML into the real characters: the named ones
 * (&amp; &quot; &apos; &lt; &gt; &nbsp;) and the numeric ones (&#039; &#x27;), so "The Old King&#039;s Crown" reads
 * "The Old King's Crown". Anything it doesn't recognise is left as it was.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
