import type { SerialPort } from './m5-dice';

export const DICE_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
interface Characteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  writeValueWithResponse(value: Uint8Array): Promise<void>;
}
interface Device extends EventTarget {
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<Characteristic> }> }>;
    disconnect(): void;
  };
}
interface BluetoothApi {
  requestDevice(options: { filters: { namePrefix: string }[]; optionalServices: string[] }): Promise<Device>;
}

/** Present BLE UART as the same bounded byte stream used by USB. */
export async function requestBlePort(): Promise<SerialPort> {
  const device = await (navigator as Navigator & { bluetooth: BluetoothApi }).bluetooth.requestDevice({
    filters: [{ namePrefix: 'Labu Dice' }], optionalServices: [DICE_SERVICE],
  });
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let tx: Characteristic | undefined;
  let ended = false;
  const onDisconnect = () => { if (!ended) { ended = true; controller?.close(); } };
  const onData = () => {
    if (!ended && tx?.value) {
      const v = tx.value;
      controller?.enqueue(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
    }
  };
  const port: SerialPort = {
    readable: null, writable: null,
    async open() {
      device.addEventListener('gattserverdisconnected', onDisconnect);
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(DICE_SERVICE);
      const rx = await service.getCharacteristic(RX);
      tx = await service.getCharacteristic(TX);
      this.readable = new ReadableStream({ start(c) { controller = c; }, cancel() { ended = true; } });
      tx.addEventListener('characteristicvaluechanged', onData);
      await tx.startNotifications();
      this.writable = new WritableStream({ async write(bytes: Uint8Array) {
        // The default BLE MTU permits 20 bytes; never depend on a larger MTU.
        for (let offset = 0; offset < bytes.length; offset += 20) {
          await rx.writeValueWithResponse(bytes.slice(offset, offset + 20));
        }
      } });
      if (!device.gatt?.connected) throw new Error('Bluetooth disconnected');
    },
    async close() {
      tx?.removeEventListener('characteristicvaluechanged', onData);
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      onDisconnect();
      device.gatt?.disconnect();
    },
  };
  return port;
}
