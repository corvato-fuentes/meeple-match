import { describe, expect, it } from 'vitest';
import { roundUp5, timeWindowOverlap, toMinutes, toTimeString, windowDuration } from './timeUtils';

describe('time helpers', () => {
  it('converts "HH:MM" to minutes and back', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('10:15')).toBe(615);
    expect(toMinutes('23:59')).toBe(1439);
    expect(toTimeString(615)).toBe('10:15');
    expect(toTimeString(5)).toBe('00:05');
  });
  it('rounds durations up to the next multiple of 5', () => {
    expect([38, 23, 40, 41, 1, 0].map(roundUp5)).toEqual([40, 25, 40, 45, 5, 0]);
  });
  it('finds the overlap of two windows, or none', () => {
    expect(timeWindowOverlap({ start: '10:00', end: '14:00' }, { start: '12:00', end: '18:00' })).toEqual({ start: '12:00', end: '14:00' });
    expect(timeWindowOverlap({ start: '10:00', end: '12:00' }, { start: '12:00', end: '18:00' })).toBeNull(); // touching is not overlapping
    expect(timeWindowOverlap({ start: '10:00', end: '11:00' }, { start: '15:00', end: '18:00' })).toBeNull();
  });
  it('measures a window', () => {
    expect(windowDuration('10:00', '11:30')).toBe(90);
  });
});
