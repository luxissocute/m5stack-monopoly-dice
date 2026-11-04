import { test, expect } from '@playwright/test';

test('wireless connection animates, settles and releases controls on radio loss', async ({ page }) => {
  await page.addInitScript(() => {
    let token = '', input = '';
    const tx = Object.assign(new EventTarget(), {
      value: new DataView(new ArrayBuffer(0)), startNotifications: async () => {},
    });
    const emit = (line: string) => {
      const bytes = new TextEncoder().encode(line + '\n');
      for (let i = 0; i < bytes.length; i += 20) {
        tx.value = new DataView(bytes.slice(i, i + 20).buffer);
        tx.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    };
    const rx = { writeValueWithResponse: async (bytes: Uint8Array) => {
      input += new TextDecoder().decode(bytes);
      if (input.endsWith('\n')) {
        token = input.trim().split(' ')[1]; input = ''; emit(`READY ${token}`);
      }
    } };
    const device = Object.assign(new EventTarget(), { gatt: {
      connected: true,
      connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async (uuid: string) => uuid.startsWith('6e400002') ? rx : tx }) }),
      disconnect: () => device.dispatchEvent(new Event('gattserverdisconnected')),
    } });
    Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
    Object.assign(window, { bleStart: () => emit(`SHAKING ${token} 1`), bleStop: () => emit(`SHAKE ${token} 1`), bleDrop: () => device.gatt.disconnect() });
  });
  await page.goto('/');
  await page.locator('.start-game').click();
  await page.locator('#m5-bluetooth').click();
  await expect(page.locator('#m5-status')).toContainText('M5Stack 已連線');
  await expect(page.locator('#m5-connect')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { bleStart(): void }).bleStart());
  await expect(page.locator('#dice-reveal')).toHaveClass(/hardware-shaking/);
  await page.evaluate(() => (window as unknown as { bleStop(): void }).bleStop());
  await expect(page.locator('#dice-reveal')).toHaveClass(/hardware-result/);
  await page.evaluate(() => (window as unknown as { bleDrop(): void }).bleDrop());
  await expect(page.locator('#m5-status')).toContainText('未連線');
  await expect(page.locator('#m5-bluetooth')).toBeEnabled();
});
