import { describe, expect, it, vi } from 'vitest';
import { startRoomServer } from './room-server';
import { RoomClient, type RoomSnapshot } from '../src/network';

describe('automatic room recovery', () => {
  it('releases lobby seats when switching to host-only mode so all friends can join', async () => {
    const service = await startRoomServer({ port: 0 });
    const owner = new RoomClient(service.url, { onSnapshot: () => {} });
    const first = new RoomClient(service.url, { onSnapshot: () => {} });
    const second = new RoomClient(service.url, { onSnapshot: () => {} });
    try {
      await owner.create({ name: '僅開主機', seats: 2 });
      const code = owner.session!.code;
      await owner.leave();
      await first.join({ name: '朋友甲', code });
      await second.join({ name: '朋友乙', code });
      expect(first.snapshot!.hostId).toBe(first.session!.playerId);
      await first.start();
      expect(first.snapshot!.game!.players.map(player => player.isNpc)).toEqual([false, false]);
    } finally { owner.close(); first.close(); second.close(); await service.close(); }
  });
  it('lets friends start a lobby after its original host leaves to run only the server', async () => {
    const service = await startRoomServer({ port: 0 });
    let guestState: RoomSnapshot | undefined;
    const host = new RoomClient(service.url, { onSnapshot: () => {} });
    const guest = new RoomClient(service.url, { onSnapshot: state => { guestState = state; } });
    try {
      await host.create({ name: '主機使用者', seats: 2 });
      await guest.join({ name: '朋友', code: host.session!.code });
      host.close();
      await vi.waitFor(() => expect(guestState?.hostId).toBe(guest.session!.playerId));
      await guest.start();
      expect(guest.snapshot?.game).not.toBeNull();
      expect(guest.snapshot!.game!.players[0].isNpc).toBe(true);
    } finally { host.close(); guest.close(); await service.close(); }
  });
  it('restores a seat after socket loss and does not repeat the previous roll', async () => {
    const service = await startRoomServer({ port: 0, stepMs: 10, rollMs: 10, disconnectGraceMs: 5000 });
    let firstState: RoomSnapshot | undefined;
    const secondUpdates: RoomSnapshot[] = [];
    const retry = vi.fn();
    const first = new RoomClient(service.url, { onSnapshot: state => { firstState = state; } });
    const second = new RoomClient(service.url, { onSnapshot: state => secondUpdates.push(state), onReconnecting: retry });
    try {
      await first.create({ name: '一號', seats: 2, maxRounds: 6 });
      await second.join({ name: '二號', code: first.session!.code });
      await first.start();
      await first.command({ type: 'roll' });
      await vi.waitFor(() => expect(firstState?.game?.phase).toBe('action'), { timeout: 3000 });
      const updatesBefore = secondUpdates.length;
      const token = second.session!.token;
      (second as unknown as { socket: WebSocket }).socket.close();
      await vi.waitFor(() => expect(retry).toHaveBeenCalled(), { timeout: 2000 });
      await vi.waitFor(() => expect(secondUpdates.length).toBeGreaterThan(updatesBefore), { timeout: 5000 });
      expect(second.session!.token).toBe(token);
      const final = secondUpdates.at(-1)!;
      expect(final.players.find(player => player.id === final.selfId)?.connected).toBe(true);
      expect(final.game!.currentPlayer).toBe(0);
      expect(final.game!.log.filter(entry => entry.text.includes('擲出'))).toHaveLength(1);
      expect(final.game!.dice).toEqual(firstState!.game!.dice);
    } finally { first.close(); second.close(); await service.close(); }
  });
});
