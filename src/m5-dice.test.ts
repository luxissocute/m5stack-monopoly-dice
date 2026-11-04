import { describe, expect, it } from 'vitest';
import { DiceProtocol } from './m5-dice';

describe('M5Stack session protocol', () => {
  it('separates start animation from release and rejects replayed starts', () => {
    const p = new DiceProtocol('motion');
    expect(p.acceptStart('SHAKING motion 1')).toBe(false);
    p.accept('READY motion');
    expect(p.acceptStart('SHAKING old 1')).toBe(false);
    expect(p.acceptStart('SHAKING motion 1')).toBe(true);
    expect(p.accept('SHAKING motion 1')).toBe(false);
    expect(p.acceptStart('SHAKING motion 1')).toBe(false);
    expect(p.accept('SHAKE motion 1')).toBe(true);
    expect(p.acceptStart('SHAKING motion 1')).toBe(false);
    expect(p.acceptStart('SHAKING motion 2')).toBe(true);
    expect(p.accept('SHAKE motion 1')).toBe(false);
  });
  it('requires handshake and ignores boot logs, bad data and old sessions', () => {
    const p = new DiceProtocol('new');
    expect(p.accept('SHAKE new 1')).toBe(false);
    expect(p.accept('boot: ESP32')).toBe(false);
    p.accept('READY old');
    expect(p.accept('SHAKE new 1')).toBe(false);
    p.accept('READY new');
    for (const line of ['SHAKE old 1', 'SHAKE new NaN', 'SHAKE new -1', 'SHAKE new 1.5', 'SHAKE new 2 extra']) expect(p.accept(line)).toBe(false);
    expect(p.accept('SHAKE new 1')).toBe(true);
  });
  it('consumes duplicates even when game permission will reject the event', () => {
    const p = new DiceProtocol('seat');
    p.accept('READY seat');
    expect(p.accept('SHAKE seat 2')).toBe(true);
    p.accept('READY seat'); // Repeated heartbeat cannot reset sequence.
    expect(p.accept('SHAKE seat 2')).toBe(false);
    expect(p.accept('SHAKE seat 1')).toBe(false);
    expect(p.accept('SHAKE seat 3')).toBe(true);
  });
  it('a new turn cannot replay buffered events from the previous turn', () => {
    const p = new DiceProtocol('turn2');
    p.accept('READY turn2');
    expect(p.accept('SHAKE turn1 99')).toBe(false);
    expect(p.accept('SHAKE turn2 1')).toBe(true);
  });
});
