const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const { createGameHost } = require('../desktop/host-service.cjs');
const { startRoomServer } = require('../desktop/generated/rooms.cjs');
const { createRequire } = require('node:module');
const { chromium } = createRequire(require.resolve('@playwright/test'))('playwright');

const peers = [];
async function peer(url, origin) {
  const socket = new WebSocket(url, { headers: { origin } });
  const messages = [];
  socket.on('message', data => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  peers.push(socket);
  let number = 0;
  return {
    socket, messages,
    async ask(type, data = {}) {
      const requestId = `proof-${++number}`;
      socket.send(JSON.stringify({ type, requestId, ...data }));
      for (let i = 0; i < 100; i++) {
        const answer = messages.find(m => m.requestId === requestId && ['ack', 'error'].includes(m.type));
        if (answer) { assert.equal(answer.type, 'ack', answer.message); return answer; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Room response timed out');
    },
    get session() { return messages.find(m => m.type === 'session')?.session; },
    get snapshot() { return messages.filter(m => m.type === 'snapshot').at(-1)?.snapshot; },
  };
}

(async () => {
  const service = await createGameHost({ root: path.resolve('dist'), port: 0, startRoomServer,
    tunnelPath: path.resolve('desktop/vendor/cloudflared.exe') });
  let browser;
  try {
    const localConfig = await fetch(service.origin + '/desktop-config.json').then(r => r.json());
    const local = await peer(localConfig.roomUrl, service.origin);
    await local.ask('create', { name: '主機玩家', seats: 4, maxRounds: 6 });
    console.log('PASS: local shared-origin room gateway.');
    const shared = await service.startSharing();
    const invitation = new URL(shared.shareUrl);
    const key = invitation.searchParams.get('access');
    let response;
    for (let i = 0; i < 20; i++) {
      try { response = await fetch(shared.shareUrl, { signal: AbortSignal.timeout(10000) }); if (response.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(response?.status, 200, 'External HTTPS game request must succeed');
    assert.equal((await fetch(invitation.origin + '/game')).status, 403, 'Missing invitation key must be rejected');
    assert.equal((await fetch(invitation.origin + '/desktop-config.json?access=wrong')).status, 403, 'Invalid key must be rejected');
    const config = await fetch(invitation.origin + '/desktop-config.json?access=' + key).then(r => r.json());
    const first = await peer(config.roomUrl, invitation.origin);
    await first.ask('create', { name: '遠端一號', seats: 2, maxRounds: 6 });
    const second = await peer(config.roomUrl, invitation.origin);
    await second.ask('join', { name: '遠端二號', code: first.session.code });
    await first.ask('start');
    await new Promise(resolve => setTimeout(resolve, 300));
    const before = first.snapshot;
    await first.ask('command', { action: { type: 'roll' }, expectedVersion: before.version });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepEqual(first.snapshot.game.dice, second.snapshot.game.dice, 'Players must see identical dice');
    const saved = second.session;
    second.socket.terminate();
    const restored = await peer(config.roomUrl, invitation.origin);
    await restored.ask('reconnect', { code: saved.code, token: saved.token });
    assert.equal(restored.snapshot.selfId, saved.playerId);
    console.log('PASS: real Internet HTTPS/WSS access, two remote seats, shared dice and authenticated reconnect.');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(shared.shareUrl, { timeout: 60000 });
    await page.locator('.start-game').waitFor();
    assert.equal(await page.evaluate(() => isSecureContext), true);
    const browserConfig = await page.evaluate(() => fetch('/desktop-config.json').then(r => r.json()));
    assert.ok(browserConfig.roomUrl.startsWith('wss://'));
    await fs.mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: 'artifacts/remote-browser.png', fullPage: true });
    assert.deepEqual(errors, [], 'Browser must load without script errors');
    console.log('PASS: external browser loads private assets and config using its secure invitation cookie.');
    const closed = new Promise(resolve => first.socket.once('close', resolve));
    service.stopSharing();
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Remote sockets were not closed')), 5000))]);
    console.log('PASS: stopping sharing closes remote sessions.');
    await fs.writeFile('artifacts/remote-proof.json', JSON.stringify({ verified: true, origin: invitation.origin, at: new Date().toISOString(), tests: ['HTTPS', 'WSS', 'access control', 'two players', 'reconnect', 'browser cookies', 'stop sharing'] }, null, 2));
  } finally {
    for (const socket of peers) socket.terminate();
    await browser?.close(); await service.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
