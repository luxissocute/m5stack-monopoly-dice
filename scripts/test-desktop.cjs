const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = createRequire(require.resolve('@playwright/test'))('playwright');

(async () => {
  const executablePath = process.argv[2] || require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: process.argv[2] ? [] : ['.'], env, timeout: 30000 });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#mode-single').click();
    await page.locator('.start-game').click();
    await page.locator('#turn-action').waitFor();
    await page.locator('#turn-action').click();
    await page.locator('#dice-reveal').waitFor({ state: 'visible' });
    await fs.mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/desktop-game.png' });
    const support = await page.evaluate(() => ({ serial: 'serial' in navigator, bluetooth: 'bluetooth' in navigator, secure: isSecureContext }));
    if (!support.serial || !support.bluetooth || !support.secure) throw new Error('Missing hardware APIs: ' + JSON.stringify(support));
    // Exercise the real Electron USB chooser and cancellation, without opening hardware.
    await page.locator('#m5-connect').click();
    let chooser;
    for (let attempt = 0; attempt < 20 && !chooser; attempt++) {
      chooser = app.windows().find(window => window !== page);
      if (!chooser) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!chooser) throw new Error('USB device chooser did not open: ' + await page.locator('#m5-status').innerText());
    await chooser.locator('#cancel').click();
    await page.locator('#m5-connect').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#m5-status')?.textContent?.includes('已取消'));
    await page.locator('#m5-bluetooth').click();
    chooser = undefined;
    for (let attempt = 0; attempt < 40 && !chooser; attempt++) {
      chooser = app.windows().find(window => window !== page);
      if (!chooser) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!chooser) throw new Error('Bluetooth chooser did not open: ' + await page.locator('#m5-status').innerText());
    await chooser.locator('#title').waitFor();
    await chooser.screenshot({ path: 'artifacts/desktop-bluetooth.png' });
    await chooser.locator('#cancel').click();
    await page.waitForFunction(() => document.querySelector('#m5-status')?.textContent?.includes('已取消'));
    const config = await page.evaluate(() => fetch('/desktop-config.json').then(response => response.json()));
    if (!config.roomUrl.startsWith('ws://127.0.0.1:')) throw new Error('Room service missing');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('PASS: desktop launches, rolls dice, renders board, has secure USB/BLE APIs, opens/cancels USB and Bluetooth choosers, starts room service.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
