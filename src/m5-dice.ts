import { requestBlePort } from './m5-ble';
/** New session tokens discard buffered events after reconnect or a turn change. */
export class DiceProtocol {
  private lastSequence = 0;
  private ready = false;
  private lastStart = 0;
  constructor(readonly token: string) {}
  acceptStart(line: string): boolean {
    const parts = line.trim().split(' ');
    const sequence = Number(parts[2]);
    if (!this.ready || parts.length !== 3 || parts[0] !== 'SHAKING' || parts[1] !== this.token ||
      !Number.isSafeInteger(sequence) || sequence <= Math.max(this.lastSequence, this.lastStart)) return false;
    this.lastStart = sequence;
    return true;
  }
  accept(line: string): boolean {
    const parts = line.trim().split(' ');
    if (parts[0] === 'READY' && parts[1] === this.token) this.ready = true;
    if (!this.ready || parts.length !== 3 || parts[0] !== 'SHAKE' || parts[1] !== this.token) return false;
    const sequence = Number(parts[2]);
    if (!Number.isSafeInteger(sequence) || sequence <= this.lastSequence || sequence < this.lastStart) return false;
    this.lastSequence = sequence;
    return true;
  }
}

// Local interfaces keep Web Serial optional on unsupported browsers.
export interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  setSignals?(signals: { dataTerminalReady: boolean; requestToSend: boolean }): Promise<void>;
  close(): Promise<void>;
}
interface SerialApi { requestPort(): Promise<SerialPort> }
export class M5Dice {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private protocol = new DiceProtocol('');
  private timer: ReturnType<typeof setInterval> | undefined;
  private writing = false;
  private closing = false;
  private context = '';
  private active = false;
  private busy = false;
  private mode: 'usb' | 'ble' = 'usb';
  get connected() { return this.port !== null && !this.closing; }
  get supported() { return window.isSecureContext && 'serial' in navigator; }
  constructor(private shake: () => void, private status: (text: string) => void,
    private shaking: (active: boolean) => void = () => {}) {}
  setContext(context: string, active: boolean) {
    if (this.context === context && this.active === active) return;
    this.context = context;
    this.active = active;
    this.shaking(false);
    this.protocol = new DiceProtocol(crypto.randomUUID());
    void this.sendSession();
  }
  private async sendSession() {
    if (!this.port?.writable || this.writing || this.closing) return;
    this.writing = true;
    const writer = this.port.writable.getWriter();
    try { await writer.write(new TextEncoder().encode(`SESSION ${this.protocol.token}\n`)); }
    catch { this.status('裝置寫入失敗，請中斷後重新連線'); }
    finally { writer.releaseLock(); this.writing = false; }
  }
  async connect(mode: 'usb' | 'ble' = 'usb') {
    if (this.busy || this.connected) return;
    if (mode === 'usb' ? !this.supported : !window.isSecureContext || !('bluetooth' in navigator)) {
      this.status('此瀏覽器不支援所選連線，請用電腦 Chrome／Edge 開啟 localhost 或 HTTPS'); return;
    }
    this.busy = true;
    this.mode = mode;
    let port: SerialPort | undefined;
    try {
      port = mode === 'ble' ? await requestBlePort() : await (navigator as Navigator & { serial: SerialApi }).serial.requestPort();
      await port.open({ baudRate: 115200 });
      // FTDI on StickC Plus wires DTR/RTS to ESP32 auto-reset. Release both
      // after opening, otherwise some browser hosts leave the chip in reset.
      await port.setSignals?.({ dataTerminalReady: false, requestToSend: false });
      this.port = port;
      this.protocol = new DiceProtocol(crypto.randomUUID());
      this.status(`${mode === 'ble' ? '藍牙' : 'USB'}已開啟，等待韌體回應`);
      this.timer = setInterval(() => { void this.sendSession(); }, 1000);
      void this.read(port);
      await this.sendSession();
    } catch (error) {
      await port?.close().catch(() => {});
      this.port = null;
      this.status(error instanceof DOMException && error.name === 'NotFoundError'
        ? '已取消選擇裝置，可隨時重新連線'
        : mode === 'ble' ? '藍牙連線失敗：請確認 Labu Dice 已開機，並中斷其他視窗的裝置連線後重試'
        : '無法開啟 USB：請關閉 Arduino 序列監控視窗，再重新連線');
    } finally { this.busy = false; }
  }
  async disconnect() {
    if (!this.port || this.closing) return;
    this.closing = true;
    this.shaking(false);
    clearInterval(this.timer);
    await this.reader?.cancel().catch(() => {});
  }
  private async read(port: SerialPort) {
    const reader = port.readable!.getReader();
    this.reader = reader;
    const decoder = new TextDecoder();
    let buffer = '';
    let dropping = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (!dropping && line.length <= 160) {
            if (line === `READY ${this.protocol.token}`) this.status(`M5Stack 已連線（${this.mode === 'ble' ? '藍牙，可拔線' : 'USB'}）；輪到你時，搖動即可擲骰`);
            if (line === 'ERROR NO_IMU') this.status('裝置找不到 IMU；請確認型號與感測器');
            if (this.protocol.acceptStart(line) && this.active && !this.closing) this.shaking(true);
            if (this.protocol.accept(line)) {
              this.shaking(false);
              if (this.active && !this.closing) this.shake();
            }
          }
          dropping = false;
        }
        if (buffer.length > 160) { buffer = ''; dropping = true; }
      }
    } catch { this.status('裝置連線中斷，仍可使用畫面上的擲骰按鈕'); }
    finally {
      clearInterval(this.timer);
      this.shaking(false);
      reader.releaseLock();
      this.reader = null;
      // An outstanding write must release its lock before closing the port.
      while (this.writing) await new Promise(resolve => setTimeout(resolve, 10));
      await port.close().catch(() => {});
      this.port = null;
      this.closing = false;
      this.protocol = new DiceProtocol('');
      this.status('M5Stack 未連線；可使用畫面上的擲骰按鈕');
    }
  }
}
