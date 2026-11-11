import { describe, expect, it } from 'vitest';
import { decodeEntities } from './htmlEntities';

describe('decodeEntities', () => {
  it('decodes numeric references, decimal and hexadecimal', () => {
    expect(decodeEntities('The Old King&#039;s Crown')).toBe("The Old King's Crown");
    expect(decodeEntities('It&#x27;s &#233;')).toBe("It's é");
  });
  it('decodes the named ones BGG uses', () => {
    expect(decodeEntities('Dungeons &amp; Dragons &quot;5e&quot; &lt;3 &apos;x&apos;')).toBe('Dungeons & Dragons "5e" <3 \'x\'');
  });
  it('leaves plain text and unknown references alone', () => {
    expect(decodeEntities('Catan')).toBe('Catan');
    expect(decodeEntities('A &unknown; B &#0; C')).toBe('A &unknown; B &#0; C');
  });
});
