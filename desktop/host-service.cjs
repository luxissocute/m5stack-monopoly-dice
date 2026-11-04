const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { spawn } = require('node:child_process');

async function createGameHost({ root, port = 49180, startRoomServer, tunnelPath, onStatus = () => {} }) {
  let rooms, child, publicOrigin = '', accessKey = '', state = 'off', lastError = '', starting;
  let shuttingDown = false;
  const connections = new Set();
  const allowedOrigins = [];
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' };
  let origin;
  const status = () => ({ state, shareUrl: state === 'on' ? `${publicOrigin}/game?access=${accessKey}` : '', error: lastError, ...rooms?.stats() });
  const changed = () => onStatus(status());
  function validKey(value) {
    if (!accessKey || typeof value !== 'string') return false;
    const left = Buffer.from(value), right = Buffer.from(accessKey);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  function requestAccess(req, url) {
    const local = req.headers.host === new URL(origin).host && !req.headers['cf-ray'];
    const cookie = /(?:^|;\s*)labu_access=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
    const external = ['starting', 'on'].includes(state) && publicOrigin && req.headers.host === new URL(publicOrigin).host &&
      (validKey(url.searchParams.get('access')) || validKey(cookie));
    return { local, external, allowed: local || external };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'");
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      const url = new URL(req.url, origin);
      const access = requestAccess(req, url);
      if (!access.allowed) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('請使用主機提供的完整邀請連結。'); return; }
      if (access.external && validKey(url.searchParams.get('access'))) {
        res.setHeader('Set-Cookie', `labu_access=${accessKey}; HttpOnly; Secure; SameSite=Lax; Path=/`);
      }
      if (url.pathname === '/desktop-config.json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const wsOrigin = access.local ? origin.replace('http:', 'ws:') : publicOrigin.replace('https:', 'wss:');
        res.end(JSON.stringify({ roomUrl: `${wsOrigin}/rooms${access.local ? '' : '?access=' + accessKey}`, inviteBase: access.local ? (status().shareUrl || `${origin}/game`) : `${publicOrigin}/game?access=${accessKey}`, hosted: true })); return;
      }
      const name = ['/', '/game'].includes(url.pathname) ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
      if (name === 'sw.js') { res.writeHead(404).end(); return; }
      const target = path.resolve(root, name);
      if (!target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403).end(); return; }
      const bytes = await fs.readFile(target);
      res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  allowedOrigins.push(origin);
  try { rooms = await startRoomServer({ port: 0, host: '127.0.0.1', allowedOrigins }); }
  catch (error) { server.close(); throw error; }
  const roomPort = Number(new URL(rooms.url).port);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, origin);
    const access = requestAccess(req, url);
    const validOrigin = req.headers.origin === origin || (state === 'on' && req.headers.origin === publicOrigin);
    if (url.pathname !== '/rooms' || !access.allowed || !validOrigin || connections.size >= 128) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const upstream = net.connect(roomPort, '127.0.0.1');
    const connection = { socket, upstream, external: access.external };
    connections.add(connection);
    const cleanup = () => { connections.delete(connection); socket.destroy(); upstream.destroy(); };
    socket.on('error', cleanup); upstream.on('error', cleanup);
    socket.on('close', cleanup); upstream.on('close', cleanup);
    upstream.once('connect', () => {
      const headers = Object.entries(req.headers).filter(([key]) => !['host', 'cookie', 'cf-access-jwt-assertion'].includes(key));
      upstream.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${roomPort}\r\n${headers.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
  });
  const stopSharing = () => {
    const previousOrigin = publicOrigin;
    state = 'off'; publicOrigin = ''; accessKey = ''; lastError = '';
    const index = allowedOrigins.indexOf(previousOrigin); if (index >= 0) allowedOrigins.splice(index, 1);
    for (const connection of connections) if (connection.external) { connection.socket.destroy(); connection.upstream.destroy(); }
    const process = child; child = null; process?.kill();
    changed();
  };
  async function startSharing() {
    if (state === 'on') return status();
    if (starting) return starting;
    state = 'starting'; lastError = ''; changed();
    starting = (async () => {
      try {
        await fs.access(tunnelPath);
        accessKey = randomBytes(24).toString('base64url');
        const process = spawn(tunnelPath, ['tunnel', '--url', origin, '--protocol', 'http2', '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        child = process;
        await new Promise((resolve, reject) => {
          let buffer = '', settled = false;
          const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('建立外網通道逾時，請確認電腦網路後重試。')); } }, 60000);
          const parse = bytes => {
            buffer = (buffer + bytes.toString()).slice(-12000);
            const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (match && /Registered tunnel connection/i.test(buffer) && !settled && child === process) {
              settled = true; clearTimeout(timer); publicOrigin = match[0]; allowedOrigins.push(publicOrigin); resolve();
            }
          };
          process.stdout.on('data', parse); process.stderr.on('data', parse);
          process.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
          process.once('exit', () => {
            clearTimeout(timer);
            if (!settled) { settled = true; reject(new Error('外網通道未能啟動，請檢查網路或重新建立。')); }
            if (child === process) {
              stopSharing(); state = 'error'; lastError = '外網通道已中斷，請重新開啟分享。'; changed();
            }
          });
        });
        if (!child || shuttingDown) throw new Error('主機已停止。');
        const deadline = Date.now() + 30000;
        let consecutive = 0;
        while (Date.now() < deadline && consecutive < 2) {
          if (child !== process || shuttingDown) throw new Error('主機已停止。');
          try {
            const response = await fetch(`${publicOrigin}/game?access=${accessKey}`, { signal: AbortSignal.timeout(5000) });
            consecutive = response.ok && (await response.text()).includes('Labu') ? consecutive + 1 : 0;
          } catch { consecutive = 0; }
          if (consecutive < 2) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (consecutive < 2) throw new Error('外網網址尚未生效，請稍候重新開啟主機。');
        state = 'on'; changed(); return status();
      } catch (error) {
        stopSharing(); state = 'error'; lastError = error.message; changed(); throw error;
      } finally { starting = null; }
    })();
    return starting;
  }
  return {
    origin, status, startSharing, stopSharing,
    async close() {
      shuttingDown = true; stopSharing();
      for (const connection of connections) { connection.socket.destroy(); connection.upstream.destroy(); }
      await rooms.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
module.exports = { createGameHost };
