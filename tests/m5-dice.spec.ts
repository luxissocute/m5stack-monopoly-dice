import { test, expect, type Page } from '@playwright/test';
import { createGame, dispatch, serializeGame } from '../src/engine';

async function mockDevice(page: Page) {
  await page.addInitScript(() => {
    let receive: ReadableStreamDefaultController<Uint8Array>;
    let token = '';
    let sequence = 0;
    let resetReleased = false;
    const encoder = new TextEncoder();
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      async open() {
        this.readable = new ReadableStream({ start(controller) { receive = controller; } });
        this.writable = new WritableStream({ write(chunk) {
          // Model StickC Plus held in reset until DTR and RTS are released.
          if (!resetReleased) return;
          const next = new TextDecoder().decode(chunk).trim().split(' ')[1];
          if (next !== token) { token = next; sequence = 0; }
          receive.enqueue(encoder.encode(`READY ${token}\n`));
        } });
      },
      async setSignals(signals: { dataTerminalReady: boolean; requestToSend: boolean }) {
        resetReleased = !signals.dataTerminalReady && !signals.requestToSend;
      },
      async close() {},
    };
    Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => port } });
    Object.assign(window, {
      mockStartShake: () => receive.enqueue(encoder.encode(`SHAKING ${token} ${sequence + 1}\n`)),
      mockShake: () => {
      const event = encoder.encode(`SHAKE ${token} ${++sequence}\n`);
      // A split line followed by a duplicate tests stream framing as well.
      receive.enqueue(event.slice(0, 8));
      receive.enqueue(event.slice(8));
      receive.enqueue(event);
    } });
  });
}
async function shake(page: Page) {
  await page.evaluate(() => (window as unknown as { mockShake: () => void }).mockShake());
}

test('USB shake rolls once, never finishes turn, and disconnect keeps button playable', async ({ page }, info) => {
  await mockDevice(page);
  const state = createGame({ seed: 'm5-hardware-mock', seats: 2, players: [{ name: '玩家' }, { name: '對手' }], maxRounds: 6 });
  state.players[0].cards.push('loadedDice');
  const fixture = serializeGame(dispatch(state, { type: 'useCard', card: 'loadedDice', value: 1 }));
  await page.addInitScript(value => localStorage.setItem('labu-toy-city-v1', value), fixture);
  await page.goto('/');
  await page.locator('#resume-game').click();
  await page.locator('#m5-connect').click();
  await expect(page.locator('#m5-status')).toContainText('M5Stack 已連線');
  await page.screenshot({ path: info.outputPath('m5-connected.png'), fullPage: true });
  await page.evaluate(() => (window as unknown as { mockStartShake: () => void }).mockStartShake());
  await expect(page.locator('#dice-reveal')).toHaveClass(/hardware-shaking/);
  await expect(page.locator('#dice-reveal')).toContainText('停下來揭曉點數');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).phase)).toBe('roll');
  // Keep shaking longer than the old fixed 2.3s animation duration.
  await page.waitForTimeout(2600);
  await expect(page.locator('#dice-reveal')).toBeVisible();
  await expect(page.locator('#dice-reveal .dice-result')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('m5-shaking.png'), fullPage: true });
  await shake(page);
  await expect(page.locator('#dice-reveal')).toHaveClass(/hardware-result/);
  await expect(page.locator('#dice-reveal .dice-result')).toContainText('1 格');
  expect(await page.locator('#dice-reveal .dice-result').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.screenshot({ path: info.outputPath('m5-settled.png'), fullPage: true });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).phase)).toBe('action');
  await shake(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).currentPlayer)).toBe(0);
  await expect(page.locator('#turn-action')).toBeVisible();
  await page.locator('#turn-action').click();
  await expect(page.locator('#m5-permission')).toContainText('等待本人回合');
  await shake(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).phase)).toBe('roll');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).currentPlayer)).toBe(1);
  await page.locator('#m5-disconnect').click();
  await expect(page.locator('#m5-status')).toContainText('未連線');
  await expect(page.locator('#turn-action')).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('m5-mobile.png'), fullPage: true });
});

test('a decision modal blocks a shake and closing it does not replay the event', async ({ page }) => {
  // Actual multiplayer authorization is covered by existing server tests.
  // Here an open decision modal blocks and consumes a shake; closing it does not replay it.
  await mockDevice(page);
  await page.goto('/');
  await page.locator('#mode-single').click();
  await page.locator('.start-game').click();
  await page.locator('#m5-connect').click();
  await expect(page.locator('#m5-status')).toContainText('M5Stack 已連線');
  await page.evaluate(() => (window as unknown as { mockStartShake: () => void }).mockStartShake());
  await expect(page.locator('#dice-reveal')).toHaveClass(/hardware-shaking/);
  await page.locator('#settings').click();
  await expect(page.locator('#dice-reveal')).toBeHidden();
  await shake(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).phase)).toBe('roll');
  await page.getByRole('button', { name: '關閉視窗' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('labu-toy-city-v1')!).phase)).toBe('roll');
});
