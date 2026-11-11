import { describe, expect, it } from 'vitest';
import { describeRequesters, isValidRequestId, requestIdFor, requestMatchesGame } from './gameRequests';

describe('describeRequesters', () => {
  it('says who would like someone to bring the game', () => {
    expect(describeRequesters(['David'], false)).toBe('A David le gustaría que alguien lo lleve');
    expect(describeRequesters(['David', 'Ana'], false)).toBe('A David y a Ana les gustaría que alguien lo lleve');
    expect(describeRequesters(['David', 'Ana', 'Beto', 'Cris'], false)).toBe('A David, Ana y 2 más les gustaría que alguien lo lleve');
  });
  it('speaks to the reader when they asked for it too', () => {
    expect(describeRequesters([], true)).toBe('Pediste que alguien lo lleve');
    expect(describeRequesters(['David'], true)).toBe('A vos y a David les gustaría que alguien lo lleve');
    expect(describeRequesters(['David', 'Ana'], true)).toBe('A vos, David y 1 más les gustaría que alguien lo lleve');
  });
});

describe('requestIdFor / isValidRequestId', () => {
  it('uses the BGG id when there is one, otherwise a slug of the name without accents', () => {
    expect(requestIdFor('316554', 'Dune: Imperium')).toBe('bgg-316554');
    expect(requestIdFor(null, 'Gloomhaven: Mandíbulas del León')).toBe('name-gloomhaven-mandibulas-del-leon');
  });
  it('only accepts ids of that shape', () => {
    expect(['bgg-1', 'bgg-316554', 'name-dune-imperium'].every(isValidRequestId)).toBe(true);
    expect(['', 'bgg-', 'bgg-abc', 'name-', 'x/../y', 'name-' + 'a'.repeat(61), 5, null].some(isValidRequestId)).toBe(false);
  });
});

describe('requestMatchesGame', () => {
  const request = { bggId: '316554', name: 'Dune: Imperium' };
  it('matches a game with the same BGG link, whatever the rest of the URL', () => {
    expect(requestMatchesGame(request, { name: 'otro nombre', bggUrl: 'https://boardgamegeek.com/boardgame/316554/dune-imperium' })).toBe(true);
    expect(requestMatchesGame(request, { name: 'x', bggUrl: 'https://boardgamegeek.com/boardgame/3165540' })).toBe(false);
  });
  it('falls back to the name, ignoring case, accents and punctuation', () => {
    expect(requestMatchesGame(request, { name: 'dune imperium' })).toBe(true);
    expect(requestMatchesGame({ bggId: null, name: 'Mandíbulas del León' }, { name: 'mandibulas del leon' })).toBe(true);
    expect(requestMatchesGame(request, { name: 'Catan' })).toBe(false);
  });
});
