import { describe, expect, it } from 'vitest';
import { remoteServer } from './remote-server';
describe('remote host addresses', () => {
  it('preserves only the access key and room in invitations', () => {
    const key = 'A'.repeat(32);
    const result = remoteServer(`https://game.example/game?access=${key}&room=AB12&tracking=private#fragment`);
    expect(result.roomUrl).toBe(`wss://game.example/rooms?access=${key}`);
    expect(result.inviteBase).toBe(`https://game.example/game?access=${key}&room=AB12`);
  });
  it('rejects insecure remote endpoints, embedded credentials and incomplete links', () => {
    for (const url of ['http://game.example', 'https://game.example', `https://user:pass@game.example/?access=${'A'.repeat(32)}`, 'javascript:alert(1)']) expect(() => remoteServer(url)).toThrow();
    expect(remoteServer('http://127.0.0.1:49180/game').roomUrl).toBe('ws://127.0.0.1:49180/rooms');
  });
});
