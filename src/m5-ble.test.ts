import { describe, it, expect, vi } from 'vitest';
import { requestBlePort } from './m5-ble';

describe('BLE byte transport', () => {
  it('chunks writes, preserves notifications and closes cleanly on radio loss', async () => {
    const tx = Object.assign(new EventTarget(), { value: new DataView(new ArrayBuffer(0)), startNotifications: vi.fn(async () => {}) });
    const writes: Uint8Array[] = [];
    const rx = { writeValueWithResponse: vi.fn(async (bytes: Uint8Array) => { writes.push(bytes); }) };
    const device = Object.assign(new EventTarget(), { gatt: {
      connected: true,
      connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async (uuid: string) => uuid.startsWith('6e400002') ? rx : tx }) }),
      disconnect: vi.fn(),
    } });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } });
    try {
      const port = await requestBlePort();
      await port.open({ baudRate: 115200 });
      const writer = port.writable!.getWriter();
      const message = new TextEncoder().encode('SESSION 01234567-89ab-cdef-0123-456789abcdef\n');
      await writer.write(message);
      expect(writes.map(w => w.length)).toEqual([20, 20, 5]);
      expect(new TextDecoder().decode(Uint8Array.from(writes.flatMap(w => [...w])))).toBe(new TextDecoder().decode(message));
      writer.releaseLock();
      const reader = port.readable!.getReader();
      tx.value = new DataView(new TextEncoder().encode('READY token\n').buffer);
      tx.dispatchEvent(new Event('characteristicvaluechanged'));
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('READY token\n');
      device.dispatchEvent(new Event('gattserverdisconnected'));
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
      await port.close();
      expect(device.gatt.disconnect).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
