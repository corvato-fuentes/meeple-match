import { describe, expect, it } from 'vitest';
import { dayLabel, isShareableTable, seatsLine, shareHeadline, shareLink, shareMessage, type ShareInfo } from './shareTable';
import type { Table } from './types';

const t = (o: Partial<Table> = {}) => ({ status: 'recommended', playerIds: ['a'], ...o }) as Pick<Table, 'status' | 'playerIds' | 'awaitingExplainer'>;
const info = (o: Partial<ShareInfo> = {}): ShareInfo => ({ gameName: 'Dune', startTime: '14:45', status: 'recommended', seated: 3, minSeats: 4, maxPlayers: 5, ...o });

describe('isShareableTable', () => {
  it('a table waiting for players or confirmed with a free place can be shared', () => {
    expect(isShareableTable(t(), { maxPlayers: 4 })).toBe(true);
    expect(isShareableTable(t({ status: 'confirmed', playerIds: ['a', 'b'] }), { maxPlayers: 4 })).toBe(true);
  });
  it('not when it is full, underway, cancelled, waiting for its explainer, or the game is unknown', () => {
    expect(isShareableTable(t({ playerIds: ['a', 'b'] }), { maxPlayers: 2 })).toBe(false);
    expect(isShareableTable(t({ status: 'in-progress' }), { maxPlayers: 4 })).toBe(false);
    expect(isShareableTable(t({ status: 'cancelled' }), { maxPlayers: 4 })).toBe(false);
    expect(isShareableTable(t({ awaitingExplainer: true }), { maxPlayers: 4 })).toBe(false);
    expect(isShareableTable(t(), undefined)).toBe(false);
  });
});

describe('shareHeadline', () => {
  it('says there is room, not how many places are left or missing (that number is old by the time it is read)', () => {
    expect(shareHeadline(info())).toBe('Hay cupos para jugar Dune a las 14:45');
    expect(shareHeadline(info({ seated: 2 }))).toBe('Hay cupos para jugar Dune a las 14:45');
    expect(shareHeadline(info({ status: 'confirmed', seated: 4 }))).toBe('Hay cupos para jugar Dune a las 14:45');
  });
  it('says which day the table is when the event day is known', () => {
    expect(dayLabel('2026-11-15')).toBe('domingo 15 de noviembre');
    expect(shareHeadline(info({ date: '2026-11-15' }))).toBe('Hay cupos para jugar Dune el domingo 15 de noviembre a las 14:45');
    expect(dayLabel('sin fecha')).toBe('sin fecha');
  });
});

describe('shareMessage', () => {
  it('one fact per line with its icon, the game in bold, where it is, and the link last', () => {
    expect(shareMessage(info({ date: '2026-11-15', endTime: '16:10', location: 'Biblioteca Popular' }), 'Jornada Meeplera', 'https://x.app/event/A/mesa/B')).toBe([
      '🎲 Hay cupos para jugar *Dune*',
      '📅 domingo 15 de noviembre',
      '🕐 14:45–16:10',
      '📍 Biblioteca Popular',
      '🎪 Jornada Meeplera',
      '',
      '👉 Sumate acá: https://x.app/event/A/mesa/B',
    ].join('\n'));
  });
  it('leaves out the lines it has no data for', () => {
    expect(shareMessage(info({ status: 'confirmed', seated: 1 }), '', 'https://x.app/l')).toBe([
      '🎲 Hay cupos para jugar *Dune*',
      '🕐 14:45',
      '',
      '👉 Sumate acá: https://x.app/l',
    ].join('\n'));
  });
});

describe('seatsLine and shareLink', () => {
  it('spells out the seats without naming anybody', () => {
    expect(seatsLine(info())).toBe('3 anotados · caben hasta 5 · faltan 1 para confirmar');
    expect(seatsLine(info({ seated: 1, minSeats: 1 }))).toBe('1 anotado · caben hasta 5 · ya está confirmada');
  });
  it('the link points at the table and carries no ticket', () => {
    expect(shareLink('https://x.app', 'ABC123', 'tbl1')).toBe('https://x.app/event/ABC123/mesa/tbl1');
  });
});
