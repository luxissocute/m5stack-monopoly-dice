const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, powerSaveBlocker, clipboard } = require('electron');
const path = require('node:path');
const { startRoomServer } = require('./generated/rooms.cjs');
const { createGameHost } = require('./host-service.cjs');
const ORIGIN = 'http://127.0.0.1:49180';
let mainWindow, gameHost, picker, tray, keepAwake, quitting = false;

function chooseDevice(kind, devices, callback) {
  if (picker?.kind === kind) { picker.update(devices); return; }
  picker?.finish('');
  const win = new BrowserWindow({ parent: mainWindow, modal: true, width: 490, height: 440,
    title: kind === 'ble' ? '選擇 Labu Dice 藍牙裝置' : '選擇 USB 連接埠',
    autoHideMenuBar: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'picker-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let list = devices, done = false;
  const send = () => { if (!win.isDestroyed()) win.webContents.send('dice-devices', { kind, devices: list }); };
  const finish = id => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    ipcMain.removeListener('dice-select', onSelect);
    picker = null;
    callback(id);
    if (!win.isDestroyed()) win.close();
  };
  const onSelect = (event, id) => {
    if (event.sender !== win.webContents) return;
    if (id === '' || list.some(d => d.id === id)) finish(id);
  };
  const timeout = setTimeout(() => finish(''), 90000);
  picker = { kind, finish, update(next) { list = next; send(); } };
  ipcMain.on('dice-select', onSelect);
  win.on('closed', () => finish(''));
  win.webContents.on('did-finish-load', send);
  win.loadFile(path.join(__dirname, 'picker.html'));
}

async function start() {
  const root = path.join(app.getAppPath(), 'dist');
  gameHost = await createGameHost({ root, startRoomServer,
    tunnelPath: app.isPackaged ? path.join(process.resourcesPath, 'cloudflared.exe') : path.join(__dirname, 'vendor/cloudflared.exe'),
    onStatus(status) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('host-status-change', status);
      if (status.state === 'on' && keepAwake === undefined) keepAwake = powerSaveBlocker.start('prevent-app-suspension');
      if (status.state !== 'on' && keepAwake !== undefined) { powerSaveBlocker.stop(keepAwake); keepAwake = undefined; }
      tray?.setToolTip(status.state === 'on' ? 'Labu 遠端主機運作中' : 'Labu 玩具城市');
    },
  });
  mainWindow = new BrowserWindow({ width: 1440, height: 1000, minWidth: 800, minHeight: 650,
    title: 'Labu 玩具城市', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'host-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const trusted = event => event.sender === mainWindow?.webContents && event.senderFrame?.url?.startsWith(ORIGIN + '/');
  const statsTimer = setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && gameHost.status().state === 'on') mainWindow.webContents.send('host-status-change', gameHost.status());
  }, 2500);
  statsTimer.unref();
  mainWindow.once('closed', () => clearInterval(statsTimer));
  ipcMain.handle('host-copy-link', (event, text) => {
    if (!trusted(event)) throw new Error('無效來源');
    if (typeof text !== 'string' || text.length > 8192) throw new Error('無效連結');
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('無效連結');
    clipboard.writeText(text);
    return clipboard.readText() === text;
  });
  ipcMain.handle('host-status', event => { if (!trusted(event)) throw new Error('無效來源'); return gameHost.status(); });
  ipcMain.handle('host-start', async event => { if (!trusted(event)) throw new Error('無效來源'); return gameHost.startSharing(); });
  ipcMain.handle('host-stop', event => { if (!trusted(event)) throw new Error('無效來源'); gameHost.stopSharing(); return gameHost.status(); });
  ipcMain.on('host-background', event => { if (trusted(event) && gameHost.status().state === 'on') mainWindow.hide(); });
  tray = new Tray(nativeImage.createFromPath(path.join(root, 'icon-192.png')).resize({ width: 20, height: 20 }));
  const show = () => { mainWindow?.show(); mainWindow?.focus(); };
  tray.setToolTip('Labu 玩具城市');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '開啟玩具城市', click: show },
    { label: '停止分享並結束', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', show);
  const ses = mainWindow.webContents.session;
  const isGameOrigin = value => { try { return new URL(value).origin === ORIGIN; } catch { return false; } };
  ses.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === mainWindow.webContents && (isGameOrigin(origin) || isGameOrigin(details.securityOrigin)) && ['serial', 'bluetooth'].includes(permission));
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(
    contents === mainWindow.webContents && contents.getURL().startsWith(ORIGIN + '/') && ['serial', 'bluetooth'].includes(permission)));
  let serialDevices = [];
  const serialList = () => serialDevices.map(p => ({ id: p.portId, name: `${p.displayName || 'USB 裝置'} (${p.portName})` }));
  ses.on('select-serial-port', (event, ports, contents, callback) => {
    event.preventDefault();
    if (contents !== mainWindow.webContents) { callback(''); return; }
    serialDevices = ports;
    chooseDevice('usb', serialList(), callback);
  });
  ses.on('serial-port-added', (_event, port) => { serialDevices.push(port); if (picker?.kind === 'usb') picker.update(serialList()); });
  ses.on('serial-port-removed', (_event, port) => { serialDevices = serialDevices.filter(p => p.portId !== port.portId); if (picker?.kind === 'usb') picker.update(serialList()); });
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    chooseDevice('ble', devices.filter(d => d.deviceName.startsWith('Labu Dice')).map(d => ({ id: d.deviceId, name: d.deviceName })), callback);
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== ORIGIN) event.preventDefault(); });
  let closePromptOpen = false;
  mainWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    void dialog.showMessageBox(mainWindow, {
      type: 'question', title: '離開玩具城市',
      message: '要關閉程式，還是留在背景執行？',
      detail: '關閉程式會停止這台主機，遠端玩家將斷線。背景執行會縮到系統匣，保留遊戲、玩家席位與主機連線。',
      buttons: ['關閉程式', '背景執行', '取消'], defaultId: 2, cancelId: 2, noLink: true,
    }).then(({ response }) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (response === 0) { quitting = true; mainWindow.close(); }
      else if (response === 1) mainWindow.hide();
    }).catch(error => console.error('Close prompt:', error.message))
      .finally(() => { closePromptOpen = false; });
  });
  mainWindow.on('closed', () => { picker?.finish(''); mainWindow = null; app.quit(); });
  await mainWindow.loadURL(ORIGIN + '/game');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('玩具城市無法啟動', error.message); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true; picker?.finish(''); tray?.destroy(); tray = null;
  void gameHost?.close().catch(error => console.error('Host shutdown:', error.message));
});
