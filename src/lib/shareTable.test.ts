import { describe, expect, it } from 'vitest';
import { isShareableTable, seatsLine, shareHeadline, shareLink, type ShareInfo } from './shareTable';
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
  it('says how many are missing to confirm, in singular and plural', () => {
    expect(shareHeadline(info())).toBe('Falta 1 para jugar Dune a las 14:45');
    expect(shareHeadline(info({ seated: 2 }))).toBe('Faltan 2 para jugar Dune a las 14:45');
  });
  it('says there is room when the table is already confirmed', () => {
    expect(shareHeadline(info({ status: 'confirmed', seated: 4 }))).toBe('Hay lugar para 1 más en Dune a las 14:45');
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
