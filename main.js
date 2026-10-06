const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, safeStorage, nativeImage } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs   = require('fs');
const https = require('https');
const http  = require('http');

// Keep the existing userData folder (config + last-opened file) stable across installer builds
app.setPath('userData', path.join(app.getPath('appData'), 'nabu-brainstorm'));

// ── HTTP GET helper (follows one redirect) ────────────────────────────────────
function httpGet(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'NabuBrainstorm/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        return httpGet(res.headers.location, redirects - 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Config helpers ────────────────────────────────────────────────────────────
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'nabu-config.json');
function readConfig(){
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8')); } catch{ return {}; }
}
function writeConfig(data){
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(data, null, 2), 'utf8'); } catch{}
}

// ── Session security ──────────────────────────────────────────────────────────
// A persistent random token guards the OBS/control routes (/obs-events, /obs-state,
// /obs-cmd, /media) so a random web page or process can't drive the overlay or read
// files. It is part of every overlay/dock URL you copy from the Help panel. The Host
// header check also blocks DNS-rebinding. Persistent so OBS URLs survive restarts.
let _token = null;
function getToken(){
  if (_token) return _token;
  const cfg = readConfig();
  if (!cfg.token){ cfg.token = crypto.randomBytes(12).toString('hex'); writeConfig(cfg); }
  return (_token = cfg.token);
}
function hostOk(req){ return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.host || ''); }
function originOk(req){ const o = req.headers.origin; return !o || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(o); }

// ── Save folder paths ─────────────────────────────────────────────────────────
const DEFAULT_BASE = () => path.join(app.getPath('documents'), 'NabuBrainstorm');
const BASE_DIR  = () => { const cfg = readConfig(); return cfg.customSaveDir || DEFAULT_BASE(); };
const AUTO_DIR  = () => path.join(BASE_DIR(), 'Autosaves');
const SAVED_DIR = () => path.join(BASE_DIR(), 'Saved');
function ensureDirs(){
  [BASE_DIR(), AUTO_DIR(), SAVED_DIR()].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); });
}

// ── External image assets ─────────────────────────────────────────────────────
// Images are base64 data URLs in memory, but saved to disk as small files in
// <save folder>\Assets\<sha1>.<ext> (content-addressed, so 30 autosaves share one copy)
// and referenced from the .brb as "asset:<name>". Opening a board inlines them again.
// "Save As…" keeps images embedded so that file stays portable on its own.
const ASSET_DIR = () => path.join(BASE_DIR(), 'Assets');
const IMG_MIME_EXT = { 'image/jpeg':'jpg', 'image/jpg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/bmp':'bmp' };
const EXT_IMG_MIME = { jpg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', bmp:'image/bmp' };
function externalize(data){
  try {
    if (!data || !Array.isArray(data.elements)) return data;
    const dir = ASSET_DIR(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return { ...data, elements: data.elements.map(el => {
      const m = el && typeof el.src === 'string' && /^data:(image\/[\w+.-]+);base64,/.exec(el.src);
      if (!m || !IMG_MIME_EXT[m[1]]) return el;
      const buf = Buffer.from(el.src.slice(m[0].length), 'base64');
      const name = crypto.createHash('sha1').update(buf).digest('hex') + '.' + IMG_MIME_EXT[m[1]];
      const fp = path.join(dir, name);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf);
      return { ...el, src: 'asset:' + name };
    }) };
  } catch(e){ return data; }   // on any failure fall back to embedding — never lose images
}
const MISSING_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="#2a2a2a"/><text x="150" y="95" fill="#999" font-size="14" text-anchor="middle" font-family="sans-serif">image file missing</text></svg>');
function internalize(data){
  try {
    if (!data || !Array.isArray(data.elements)) return data;
    data.elements.forEach(el => {
      if (!el || typeof el.src !== 'string' || !el.src.startsWith('asset:')) return;
      const name = path.basename(el.src.slice(6));
      try {
        const buf = fs.readFileSync(path.join(ASSET_DIR(), name));
        el.src = `data:${EXT_IMG_MIME[path.extname(name).slice(1)] || 'image/jpeg'};base64,${buf.toString('base64')}`;
      } catch(e){ el.src = MISSING_IMG; }
    });
  } catch(e){}
  return data;
}
// Delete asset files no remaining .brb references (older than 10 min so a save in flight is safe)
function pruneAssets(){
  try {
    const dir = ASSET_DIR(); if (!fs.existsSync(dir)) return;
    const used = new Set();
    [AUTO_DIR(), SAVED_DIR()].forEach(d => { try {
      fs.readdirSync(d).filter(f => f.endsWith('.brb')).forEach(f => {
        const txt = fs.readFileSync(path.join(d, f), 'utf8');
        (txt.match(/asset:[0-9a-f]{40}\.\w+/g) || []).forEach(a => used.add(a.slice(6)));
      });
    } catch(e){} });
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      if (!used.has(f) && Date.now() - fs.statSync(fp).mtimeMs > 600000) { try { fs.unlinkSync(fp); } catch(e){} }
    });
  } catch(e){}
}

// Make a safe timestamp string
function timestamp(){ return new Date().toISOString().replace(/:/g,'-').slice(0,16); }

// Enforce cap: keep only most-recent `keep` files, delete the rest
function enforceCap(dir, keep){
  try{
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.brb'))
      .map(f => ({ name:f, mtime: fs.statSync(path.join(dir,f)).mtimeMs }))
      .sort((a,b) => b.mtime - a.mtime);
    files.slice(keep).forEach(f => { try{ fs.unlinkSync(path.join(dir, f.name)); }catch{} });
  }catch{}
}

let win;

// ── Local HTTP server ─────────────────────────────────────────────────────────
// Serving from http://127.0.0.1 gives the page a real HTTP origin so that
// Instagram/Twitter embeds and webviews satisfy third-party referrer checks.
const SERVE_MIME = {
  '.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime', '.mkv':'video/x-matroska',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.m4a':'audio/mp4', '.ogg':'audio/ogg', '.flac':'audio/flac',
  '.pdf':'application/pdf'
};

// ── OBS overlay relay ─────────────────────────────────────────────────────────
// The main window POSTs board/viewport state to /obs-state; any number of
// ?obs=1 overlay pages (OBS Browser Sources) subscribe via SSE at /obs-events.
// State is module-level so it survives extra server instances (export window).
let obsClients = [];
const obsLast = {};   // last message per type, replayed to newly connected overlays

const MEDIA_EXT = new Set(['.png','.jpg','.jpeg','.gif','.webp','.svg','.mp4','.webm','.mov','.mkv','.mp3','.wav','.m4a','.ogg','.flac','.pdf']);
function handleObsRoutes(req, res, urlPath){
  if (['/obs-events','/obs-state','/obs-cmd','/media'].includes(urlPath)){
    const q = new URL(req.url, 'http://x').searchParams;
    if (q.get('k') !== getToken() || !originOk(req)){ res.writeHead(403); res.end(); return true; }
  }
  if (urlPath === '/obs-events'){
    res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
    res.write(':ok\n\n');
    obsClients.push(res);
    Object.values(obsLast).forEach(m => res.write(`data: ${m}\n\n`));
    req.on('close', () => { obsClients = obsClients.filter(c => c !== res); });
    return true;
  }
  if (urlPath === '/obs-state' && req.method === 'POST'){
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64e6) req.destroy(); });
    req.on('end', () => {
      try { obsLast[JSON.parse(body).type] = body; } catch(e){ res.writeHead(400); res.end(); return; }
      obsClients.forEach(c => { try { c.write(`data: ${body}\n\n`); } catch(e){} });
      res.writeHead(204); res.end();
    });
    return true;
  }
  if (urlPath === '/obs-cmd'){
    // Trigger a one-at-a-time cut-in from anything that can make an HTTP GET:
    // the ?remote=1 OBS dock, Stream Deck, a browser bookmark, OBS hotkey scripts…
    // e.g. /obs-cmd?a=next  /obs-cmd?a=prev  /obs-cmd?a=hide  /obs-cmd?a=goto&n=3
    const q = new URL(req.url, 'http://x').searchParams;
    sendShowCmd({ a: q.get('a') || '', n: q.get('n') });
    res.writeHead(200, { 'Content-Type':'application/json' }); res.end('{"ok":true}');
    return true;
  }
  if (urlPath === '/media'){
    // Streams a local media file (with Range support so video can seek) for the OBS
    // overlay, which cannot use file:// URLs. Media extensions only; token-guarded.
    const p = new URL(req.url, 'http://x').searchParams.get('p') || '';
    const ext = path.extname(p).toLowerCase();
    if (!MEDIA_EXT.has(ext)){ res.writeHead(403); res.end(); return true; }
    fs.stat(p, (err, st) => {
      if (err || !st.isFile()){ res.writeHead(404); res.end(); return; }
      const type = SERVE_MIME[ext] || 'application/octet-stream';
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m){
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
        if (start > end || start >= st.size){ res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
        res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(p, { start, end }).on('error', () => res.destroy()).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
        fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
      }
    });
    return true;
  }
  return false;
}

function startLocalServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (!hostOk(req)){ res.writeHead(403); res.end(); return; }
      let urlPath = req.url.split('?')[0];
      if (handleObsRoutes(req, res, urlPath)) return;
      if (urlPath === '/') urlPath = '/board.html';
      const filePath = path.resolve(__dirname, '.' + urlPath);
      if (filePath !== __dirname && !filePath.startsWith(__dirname + path.sep)) { res.writeHead(403); res.end(); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': SERVE_MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    // Prefer stable ports so the OBS browser-source URL survives app restarts
    const tryPorts = [41414, 41415, 41416, 41417, 41418, 41419, 0];
    const attempt = i => {
      srv.once('error', () => attempt(Math.min(i+1, tryPorts.length-1)));
      srv.listen(tryPorts[i], '127.0.0.1', () => { srv.removeAllListeners('error'); resolve(srv.address().port); });
    };
    attempt(0);
  });
}

function sendShowCmd(cmd){ if (win && !win.isDestroyed()) win.webContents.send('show-cmd', cmd); }
// Global hotkeys work even while OBS (or any other app) has focus. Rebindable in the
// Help → OBS Guide → Settings panel; stored in nabu-config.json.
const DEFAULT_HOTKEYS = { next:'CommandOrControl+Alt+Right', prev:'CommandOrControl+Alt+Left', hide:'CommandOrControl+Alt+Down', laser:'CommandOrControl+Alt+L' };
let hotkeyStatus = {};
function currentHotkeys(){ return { ...DEFAULT_HOTKEYS, ...(readConfig().hotkeys || {}) }; }
function registerShowHotkeys(){
  globalShortcut.unregisterAll();
  hotkeyStatus = {};
  Object.entries(currentHotkeys()).forEach(([a, acc]) => {
    try { hotkeyStatus[a] = !!acc && globalShortcut.register(acc, () => sendShowCmd({ a })); }
    catch(e){ hotkeyStatus[a] = false; }
  });
  return hotkeyStatus;
}
ipcMain.handle('get-hotkeys', () => ({ hotkeys: currentHotkeys(), defaults: DEFAULT_HOTKEYS, status: hotkeyStatus }));
ipcMain.handle('set-hotkeys', (_, hk) => {
  const clean = {};
  Object.keys(DEFAULT_HOTKEYS).forEach(a => { if (hk && typeof hk[a] === 'string') clean[a] = hk[a].trim(); });
  const cfg = readConfig(); cfg.hotkeys = clean; writeConfig(cfg);
  return { hotkeys: currentHotkeys(), status: registerShowHotkeys() };
});
app.on('will-quit', () => globalShortcut.unregisterAll());

let serverPort = null;
let notesWin = null;

async function createWindow() {
  const port = await startLocalServer();
  serverPort = port;
  win = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 800, minHeight: 500,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,   // needed for local file:// media paths
      webviewTag: true      // needed for Instagram/social embeds in Quick Look
    }
  });
  win.loadURL(`http://127.0.0.1:${port}/board.html?k=${getToken()}`);
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
}

// ── Presenter Notes window ────────────────────────────────────────────────────
// A genuinely separate OS window (own title, normal frame) so an OBS Window
// Capture of the board never picks it up — it's for the presenter's own eyes,
// e.g. dragged onto a second monitor. Mirrors the board over the same SSE
// channel the OBS overlay uses (/obs-events), just filtered client-side.
ipcMain.handle('open-notes-window', () => {
  if (notesWin && !notesWin.isDestroyed()){ notesWin.focus(); return true; }
  notesWin = new BrowserWindow({
    width: 520, height: 420,
    minWidth: 360, minHeight: 260,
    title: 'NabuBrainstorm — Presenter Notes',
    backgroundColor: '#1A1A1A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });
  notesWin.setMenuBarVisibility(false);
  // board.html's <title> tag would otherwise overwrite our title once the page loads —
  // keep it fixed so this window is always distinguishable by name from the board
  // window in OBS's Window Capture source list (that's the whole point of this window).
  notesWin.on('page-title-updated', e => e.preventDefault());
  notesWin.loadURL(`http://127.0.0.1:${serverPort}/board.html?notes=1&k=${getToken()}`);
  notesWin.on('closed', () => { notesWin = null; });
  return true;
});

// Edit made in the Notes window's Edit mode → relayed straight to the board
// window over IPC (not the HTTP/SSE relay — that's one-way, main → overlays).
ipcMain.on('notes-edit', (e, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('notes-edit', payload);
});

app.whenReady().then(() => { createWindow(); registerShowHotkeys(); });
app.on('window-all-closed', () => app.quit());

// ── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('win-minimize', () => win.minimize());
ipcMain.on('win-maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win-close',    () => win.close());
ipcMain.on('close-now',    () => { win.destroy(); app.quit(); });
ipcMain.handle('set-fullscreen', (_, on) => { win.setFullScreen(on); return on; });

// ── Board file operations ────────────────────────────────────────────────────
ipcMain.handle('board-new', () => {
  const data = { title: 'Untitled Board', elements: [], connectors: [], savedAt: new Date().toISOString() };
  return { success: true, filePath: null, data };
});

// Auto-save: called on a timer, saves to Autosaves/ folder, cap 30
ipcMain.handle('board-save-auto', async (_, { data }) => {
  try {
    ensureDirs();
    const safe = (data.title || 'Board').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'_') || 'Board';
    const fname = `${safe}_${timestamp()}_autosave.brb`;
    const fpath = path.join(AUTO_DIR(), fname);
    fs.writeFileSync(fpath, JSON.stringify(externalize(data), null, 2), 'utf8');
    enforceCap(AUTO_DIR(), 30); pruneAssets();
    return { success: true, filePath: fpath };
  } catch(err){ return { success: false, error: err.message }; }
});

// Manual user save: saves to Saved/ folder, cap 10
ipcMain.handle('board-save-user', async (_, { data }) => {
  try {
    ensureDirs();
    const safe = (data.title || 'Board').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'_') || 'Board';
    const fname = `${safe}_${timestamp()}.brb`;
    const fpath = path.join(SAVED_DIR(), fname);
    fs.writeFileSync(fpath, JSON.stringify(externalize(data), null, 2), 'utf8');
    enforceCap(SAVED_DIR(), 10); pruneAssets();
    const cfg = readConfig(); cfg.lastSavedFile = fpath; writeConfig(cfg);
    return { success: true, filePath: fpath };
  } catch(err){ return { success: false, error: err.message }; }
});

// Save As: lets the user pick the destination filename/folder via a native dialog
ipcMain.handle('board-save-as', async (_, { data, title }) => {
  try {
    const safe = (title || 'Board').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'_') || 'Board';
    const res = await dialog.showSaveDialog(win, {
      title: 'Save Board As',
      defaultPath: path.join(SAVED_DIR(), `${safe}.brb`),
      filters: [{ name: 'NabuBrainstorm Board', extensions: ['brb'] }]
    });
    if (res.canceled || !res.filePath) return { success: false };
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
    const cfg = readConfig(); cfg.lastSavedFile = res.filePath; cfg.lastOpenedFile = res.filePath; writeConfig(cfg);
    return { success: true, filePath: res.filePath };
  } catch(err){ return { success: false, error: err.message }; }
});

// Keep the old board-save for compatibility (inline saves if a filePath exists)
ipcMain.handle('board-save', async (_, { filePath, data }) => {
  try {
    if (!filePath) return { success: false };
    fs.writeFileSync(filePath, JSON.stringify(externalize(data), null, 2), 'utf8');
    return { success: true, filePath };
  } catch(err){ return { success: false, error: err.message }; }
});

// Open: shows file dialog or loads a specific path; records last-opened
ipcMain.handle('board-open', async (_, filePath) => {
  try {
    if (!filePath) {
      const res = await dialog.showOpenDialog(win, {
        title: 'Open Board',
        filters: [{ name: 'NabuBrainstorm Board', extensions: ['brb','board.json','json'] }],
        properties: ['openFile']
      });
      if (res.canceled || !res.filePaths.length) return { success: false };
      filePath = res.filePaths[0];
    }
    const data = internalize(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    const cfg = readConfig(); cfg.lastOpenedFile = filePath; writeConfig(cfg);
    return { success: true, filePath, data };
  } catch(err){ return { success: false, error: err.message }; }
});

// Last-opened file
ipcMain.handle('get-last-file', () => {
  const cfg = readConfig();
  const fp = cfg.lastOpenedFile || cfg.lastSavedFile || null;
  if (fp && fs.existsSync(fp)) return { success: true, filePath: fp };
  // Try last autosave as fallback
  try {
    ensureDirs();
    const files = fs.readdirSync(AUTO_DIR())
      .filter(f => f.endsWith('.brb'))
      .map(f => ({ name:f, mtime: fs.statSync(path.join(AUTO_DIR(),f)).mtimeMs }))
      .sort((a,b) => b.mtime - a.mtime);
    if (files.length) return { success: true, filePath: path.join(AUTO_DIR(), files[0].name), isAutoRecovery: true };
  }catch{}
  return { success: false };
});

// List autosaves and manual saves for the Restore panel
ipcMain.handle('list-saves', () => {
  try {
    ensureDirs();
    const mapDir = (dir, type) => fs.readdirSync(dir)
      .filter(f => f.endsWith('.brb'))
      .map(f => {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        return { name: f, filePath: fp, mtime: stat.mtimeMs, type };
      })
      .sort((a,b) => b.mtime - a.mtime);
    return {
      success: true,
      autosaves: mapDir(AUTO_DIR(),'auto'),
      saved: mapDir(SAVED_DIR(),'saved'),
      autoDir: AUTO_DIR(),
      savedDir: SAVED_DIR(),
      baseDir: BASE_DIR(),
      isCustom: !!readConfig().customSaveDir
    };
  }catch(err){ return { success:false, error: err.message }; }
});

// Open a folder in Explorer
ipcMain.handle('open-folder', async (_, folderPath) => {
  try { await shell.openPath(folderPath); return { success: true }; }
  catch(err){ return { success: false, error: err.message }; }
});

// Get current save dirs + config
ipcMain.handle('get-save-dirs', () => {
  ensureDirs();
  return { autoDir: AUTO_DIR(), savedDir: SAVED_DIR(), baseDir: BASE_DIR(), isCustom: !!readConfig().customSaveDir };
});

// Let user pick a new save root folder
ipcMain.handle('set-save-dir', async () => {
  try {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose Save Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { success: false };
    const chosen = res.filePaths[0];
    const cfg = readConfig(); cfg.customSaveDir = chosen; writeConfig(cfg);
    ensureDirs();
    return { success: true, baseDir: chosen, autoDir: AUTO_DIR(), savedDir: SAVED_DIR() };
  }catch(err){ return { success: false, error: err.message }; }
});

// Reset save dir to default
ipcMain.handle('reset-save-dir', () => {
  const cfg = readConfig(); delete cfg.customSaveDir; writeConfig(cfg);
  ensureDirs();
  return { success: true, baseDir: BASE_DIR(), autoDir: AUTO_DIR(), savedDir: SAVED_DIR() };
});

// ── Image reading ────────────────────────────────────────────────────────────
// renderer checks `img.success` and reads `img.dataUrl`
const MIME = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
  gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp'
};

ipcMain.handle('read-image-file', (_, filePath) => {
  try {
    const buf  = fs.readFileSync(filePath);
    const ext  = path.extname(filePath).slice(1).toLowerCase();
    const mime = MIME[ext] || 'image/jpeg';
    return { success: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── Pick image folder ─────────────────────────────────────────────────────────
// renderer checks `r.success` and iterates `r.files`
ipcMain.handle('pick-image-folder', async () => {
  try {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose Image Folder', properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { success: false };
    const dir     = res.filePaths[0];
    const imgExts = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp']);
    const files   = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && imgExts.has(path.extname(e.name).toLowerCase()))
      .map(e => ({ filePath: path.join(dir, e.name), fileName: e.name }));
    if (!files.length) return { success: false, error: 'No images found in that folder' };
    return { success: true, files };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── Asset / file picker ──────────────────────────────────────────────────────
// renderer checks `r.success`, reads `r.filePath`, `r.fileName`, `r.files`
ipcMain.handle('pick-asset-file', async (_, { extensions = [], multi = false } = {}) => {
  try {
    const filters = extensions.length
      ? [{ name: 'Files', extensions }]
      : [{ name: 'All Files', extensions: ['*'] }];
    const res = await dialog.showOpenDialog(win, {
      title: multi ? 'Select Asset File(s)' : 'Select Asset File',
      filters,
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return { success: false };
    const files = res.filePaths.map(fp => ({ filePath: fp, fileName: path.basename(fp) }));
    return { success: true, filePath: files[0].filePath, fileName: files[0].fileName, files };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── Shell helpers ─────────────────────────────────────────────────────────────
ipcMain.handle('open-file', async (_, fp) => {
  try { await shell.openPath(fp); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('open-external', async (_, url) => {
  try { await shell.openExternal(url); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

// ── Export PNG ────────────────────────────────────────────────────────────────
ipcMain.handle('export-png', async (_, { title }) => {
  try {
    const image = await win.webContents.capturePage();
    const buf = image.toPNG();
    const safeName = (title || 'board').replace(/[^\w\s-]/g,'').trim() || 'board';
    const res = await dialog.showSaveDialog(win, {
      title: 'Export Board as PNG',
      defaultPath: path.join(app.getPath('pictures'), `${safeName}.png`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    if (res.canceled || !res.filePath) return { success: false };
    fs.writeFileSync(res.filePath, buf);
    return { success: true, filePath: res.filePath };
  } catch (err) { return { success: false, error: err.message }; }
});

// ── Export PNG / WebP (transparent / tiled / custom bg) ────────────────────────
// Renders the board in a separate hidden, transparent BrowserWindow so capturePage()
// can return an alpha channel — the main window isn't created with transparent:true.
// Round-trips a captured PNG through the export window's <canvas> to encode it as
// WebP (Chromium has a native WebP encoder; no extra native module needed).
async function convertPngToWebp(exportWin, pngBuf, quality) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const base64 = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebP conversion timed out')), 8000);
    ipcMain.once('webp-result', (_e, result) => {
      if (result.id !== id) { reject(new Error('WebP result mismatch')); return; }
      clearTimeout(timer); resolve(result.base64);
    });
    exportWin.webContents.send('convert-to-webp', { id, base64: pngBuf.toString('base64'), quality: quality ?? 0.92 });
  });
  return Buffer.from(base64, 'base64');
}
// Composites N internally-captured chunk PNGs into ONE tall canvas and encodes the
// result — this is how "single image" mode produces exactly one output file no
// matter how long the board is, while each individual capturePage() call stays
// within a safe window height.
async function stitchChunks(exportWin, buffers, frameW, chunkH, totalH, format, quality) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const base64 = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Stitching the board into one file timed out')), 30000);
    ipcMain.once('stitch-result', (_e, result) => {
      if (result.id !== id) { reject(new Error('Stitch result mismatch')); return; }
      clearTimeout(timer); resolve(result.base64);
    });
    exportWin.webContents.send('stitch-tiles', {
      id, tiles: buffers.map(b => b.toString('base64')), frameW, chunkH, totalH, format, quality: quality ?? 0.92
    });
  });
  return Buffer.from(base64, 'base64');
}

ipcMain.handle('export-png-advanced', async (_, payload) => {
  const { title, board, transparent, bgColor, showSerials, format, webpQuality, stitch, stitchHeight,
          zoom, originX, originY, pad, frameW, frameH, tileCount } = payload;
  const ext = format === 'webp' ? 'webp' : format === 'jpg' ? 'jpg' : 'png';
  let exportWin;
  try {
    exportWin = new BrowserWindow({
      width: frameW, height: frameH, show: false, frame: false,
      transparent: !!transparent,
      backgroundColor: transparent ? '#00000000' : (bgColor || '#ffffff'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false,
        webviewTag: true
      }
    });
    const port = await startLocalServer();
    await new Promise((resolve, reject) => {
      exportWin.webContents.once('did-finish-load', resolve);
      exportWin.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(desc || ('load failed: '+code))));
      exportWin.loadURL(`http://127.0.0.1:${port}/board.html?exportMode=1`);
    });
    exportWin.webContents.send('export-init', { board, transparent, bgColor, showSerials, zoom, originX, originY, pad, frameW, frameH });
    await new Promise(resolve => ipcMain.once('export-frame-ready', resolve));
    await new Promise(r => setTimeout(r, 200));

    // Always capture each chunk as raw PNG — format conversion happens once at
    // the end (either per-tile below, or as part of the stitch step).
    const safeName = (title || 'board').replace(/[^\w\s-]/g, '').trim() || 'board';
    const buffers = [];
    for (let i = 0; i < tileCount; i++) {
      if (i > 0) {
        exportWin.webContents.send('export-set-tile', i);
        await new Promise(resolve => ipcMain.once('export-frame-ready', resolve));
        await new Promise(r => setTimeout(r, 150));
      }
      const image = await exportWin.webContents.capturePage();
      buffers.push(image.toPNG());
    }

    let finalBuffers;
    if (stitch) {
      if (tileCount === 1) {
        finalBuffers = [ format === 'webp' ? await convertPngToWebp(exportWin, buffers[0], webpQuality) : buffers[0] ];
      } else {
        finalBuffers = [ await stitchChunks(exportWin, buffers, frameW, frameH, stitchHeight, format, webpQuality) ];
      }
    } else {
      finalBuffers = format === 'webp'
        ? await Promise.all(buffers.map(b => convertPngToWebp(exportWin, b, webpQuality)))
        : buffers;
    }

    if (format === 'jpg') finalBuffers = finalBuffers.map(b => nativeImage.createFromBuffer(b).toJPEG(92));
    if (finalBuffers.length === 1) {
      const res = await dialog.showSaveDialog(win, {
        title: 'Export Board as Image',
        defaultPath: path.join(app.getPath('pictures'), `${safeName}.${ext}`),
        filters: [{ name: ext.toUpperCase()+' Image', extensions: [ext] }]
      });
      if (res.canceled || !res.filePath) return { success: false };
      fs.writeFileSync(res.filePath, finalBuffers[0]);
      return { success: true, filePath: res.filePath };
    } else {
      const res = await dialog.showOpenDialog(win, {
        title: 'Choose folder for the image strip',
        properties: ['openDirectory', 'createDirectory']
      });
      if (res.canceled || !res.filePaths[0]) return { success: false };
      const dir = res.filePaths[0];
      const numDigits = String(finalBuffers.length).length;
      finalBuffers.forEach((buf, i) => {
        const n = String(i + 1).padStart(numDigits, '0');
        fs.writeFileSync(path.join(dir, `${safeName}_part${n}.${ext}`), buf);
      });
      return { success: true, filePath: dir, count: finalBuffers.length };
    }
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (exportWin) exportWin.destroy();
  }
});

// ── Social embed metadata fetch ───────────────────────────────────────────────
ipcMain.handle('fetch-embed-data', async (_, { url, embedType }) => {
  try {
    if (embedType === 'youtube') {
      const raw = await httpGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      const d = JSON.parse(raw);
      return { success: true, data: { title: d.title, author: d.author_name, thumbnailUrl: d.thumbnail_url } };
    }
    if (embedType === 'twitter') {
      const raw = await httpGet(`https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`);
      const d = JSON.parse(raw);
      const m = d.html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const tweetText = m ? m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim() : '';
      const handleM = (d.author_url || '').match(/(?:twitter|x)\.com\/([^/?#\s]+)/);
      const handle = handleM ? '@' + handleM[1] : '';
      const hasMedia = /pic\.twitter\.com/i.test(d.html);
      return { success: true, data: { author: d.author_name, handle, tweetText, embedHtml: d.html, hasMedia } };
    }
    return { success: false };
  } catch(err) {
    return { success: false, error: err.message };
  }
});

// ── App info ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-version', () => app.getVersion());

// ── Auto-update ───────────────────────────────────────────────────────────────
// Two sources, checked in this order when you click ⟳ Update:
//  1. The Updates folder  (Documents\NabuBrainstorm\Updates) — drop a newer
//     "NabuBrainstorm Setup x.y.z.exe" in there and the button installs it. No internet needed.
//  2. GitHub Releases (electron-updater) — packaged/installed builds only.
const UPDATES_DIR = () => path.join(BASE_DIR(), 'Updates');
function ensureUpdatesDir(){
  const d = UPDATES_DIR();
  try {
    fs.mkdirSync(d, { recursive: true });
    const r = path.join(d, 'README.txt');
    if (!fs.existsSync(r)) fs.writeFileSync(r,
      'NabuBrainstorm — Updates folder\r\n\r\nDrop a newer installer here (named like "NabuBrainstorm Setup 1.13.0.exe")\r\n' +
      'then click the ⟳ Update button in the app. It installs the newest version found here\r\n' +
      'and restarts. Your boards are never touched.\r\n');
  } catch(e){}
  return d;
}
function cmpVer(a, b){
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++){ if ((x[i]||0) !== (y[i]||0)) return (x[i]||0) - (y[i]||0); }
  return 0;
}
function findLocalUpdate(){
  try {
    const d = ensureUpdatesDir(), cur = app.getVersion(); let best = null;
    fs.readdirSync(d).forEach(f => {
      const m = /^NabuBrainstorm[ -]Setup[ -](\d+\.\d+\.\d+)\.exe$/i.exec(f);
      if (m && cmpVer(m[1], cur) > 0 && (!best || cmpVer(m[1], best.version) > 0)) best = { version: m[1], file: path.join(d, f) };
    });
    return best;
  } catch(e){ return null; }
}
let localUpdate = null;
let autoUpdater = null;
function sendUpdate(state, extra = {}){
  if (win && !win.isDestroyed()) win.webContents.send('update-status', { state, ...extra });
}
function friendlyUpdateError(e){
  const m = String((e && e.message) || e || '');
  if (/app-update\.yml/i.test(m)) return 'This build has no online-update info — use the Updates folder (Help → 📁 Updates folder).';
  if (/404|406|latest\.yml|No published versions|Cannot find/i.test(m)) return 'No published release found yet — put the new installer in the Updates folder instead.';
  if (/ENOTFOUND|ECONN|ETIMEDOUT|net::|network/i.test(m)) return 'Could not reach GitHub — check your internet, or use the Updates folder.';
  return m.slice(0, 160);
}
function initUpdater(){
  if (!app.isPackaged || autoUpdater) return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
    autoUpdater.on('update-available',    i => sendUpdate('available', { version: i.version, source: 'github' }));
    autoUpdater.on('update-not-available',() => sendUpdate('none'));
    autoUpdater.on('download-progress',   p => sendUpdate('downloading', { percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded',   i => sendUpdate('ready', { version: i.version, source: 'github' }));
    autoUpdater.on('error',               e => sendUpdate('error', { message: friendlyUpdateError(e) }));
  } catch(e){ autoUpdater = null; }
}
ipcMain.handle('update-check', async () => {
  sendUpdate('checking');
  localUpdate = findLocalUpdate();
  if (localUpdate){ sendUpdate('available', { version: localUpdate.version, source: 'folder' }); return { success: true }; }
  initUpdater();
  if (!autoUpdater){ sendUpdate('dev'); return { success: false, dev: true }; }
  try { await autoUpdater.checkForUpdates(); return { success: true }; }
  catch(e){ sendUpdate('error', { message: friendlyUpdateError(e) }); return { success: false }; }
});
ipcMain.handle('update-download', async () => {
  if (localUpdate){ sendUpdate('ready', { version: localUpdate.version, source: 'folder' }); return { success: true }; }
  if (!autoUpdater) return { success: false };
  try { await autoUpdater.downloadUpdate(); return { success: true }; }
  catch(e){ sendUpdate('error', { message: friendlyUpdateError(e) }); return { success: false }; }
});
ipcMain.on('update-install', () => {
  if (localUpdate){
    const file = localUpdate.file;
    // Launch the installer once this app has fully exited so it can replace the files.
    app.once('quit', () => {
      try { require('child_process').spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref(); } catch(e){}
    });
    app.quit(); return;
  }
  if (autoUpdater) autoUpdater.quitAndInstall();
});
ipcMain.handle('open-updates-folder', async () => { await shell.openPath(ensureUpdatesDir()); return { success: true, dir: UPDATES_DIR() }; });
app.whenReady().then(() => setTimeout(() => {
  ensureUpdatesDir();
  localUpdate = findLocalUpdate();
  if (localUpdate){ sendUpdate('available', { version: localUpdate.version, source: 'folder' }); return; }
  initUpdater(); if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {});
}, 5000));

// ── Teleprompter window ───────────────────────────────────────────────────────
let prompterWin = null;
ipcMain.handle('open-prompter-window', () => {
  if (prompterWin && !prompterWin.isDestroyed()){ prompterWin.focus(); return true; }
  prompterWin = new BrowserWindow({
    width: 760, height: 520, minWidth: 360, minHeight: 240,
    title: 'NabuBrainstorm — Teleprompter', backgroundColor: '#000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webSecurity: false }
  });
  prompterWin.setMenuBarVisibility(false);
  prompterWin.on('page-title-updated', e => e.preventDefault());
  prompterWin.loadURL(`http://127.0.0.1:${serverPort}/board.html?prompter=1&k=${getToken()}`);
  prompterWin.on('closed', () => { prompterWin = null; });
  return true;
});

// ── OBS WebSocket client (OBS 28+ built-in server, protocol v5) ───────────────
// Lets the app switch scenes, start/stop recording and drop chapter markers when a
// cut-in goes live. In OBS: Tools → WebSocket Server Settings → enable, set a password.
const obs = { ws: null, ready: false, id: 0, pending: new Map(), recording: false, scene: '', scenes: [], error: '' };
function obsPushStatus(){
  if (win && !win.isDestroyed()) win.webContents.send('obs-status', {
    connected: obs.ready, recording: obs.recording, scene: obs.scene, scenes: obs.scenes, error: obs.error
  });
}
function obsSettings(){
  const cfg = readConfig(); const o = cfg.obs || {};
  return { host: o.host || '127.0.0.1', port: o.port || 4455, autoConnect: !!o.autoConnect, hasPassword: !!cfg.obsPwd, canStorePassword: safeStorage.isEncryptionAvailable() };
}
function obsStoredPassword(){
  try { const b = readConfig().obsPwd; return b ? safeStorage.decryptString(Buffer.from(b, 'base64')) : ''; } catch(e){ return ''; }
}
function obsRequest(type, data = {}){
  return new Promise((resolve, reject) => {
    if (!obs.ready || !obs.ws) return reject(new Error('OBS not connected'));
    const requestId = String(++obs.id);
    const t = setTimeout(() => { obs.pending.delete(requestId); reject(new Error('OBS request timed out')); }, 5000);
    obs.pending.set(requestId, { resolve, reject, t });
    obs.ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } }));
  });
}
async function obsRefresh(){
  try {
    const sc = await obsRequest('GetSceneList');
    obs.scenes = (sc.responseData.scenes || []).map(x => x.sceneName).reverse();
    obs.scene = sc.responseData.currentProgramSceneName || '';
    const rs = await obsRequest('GetRecordStatus');
    obs.recording = !!rs.responseData.outputActive;
  } catch(e){}
  obsPushStatus();
}
function obsDisconnect(){
  if (obs.ws){ try { obs.ws.close(); } catch(e){} }
  obs.ws = null; obs.ready = false; obs.recording = false;
  obs.pending.forEach(p => { clearTimeout(p.t); p.reject(new Error('disconnected')); }); obs.pending.clear();
}
function obsConnect({ host, port, password }){
  obsDisconnect(); obs.error = '';
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done){ done = true; obsPushStatus(); resolve(r); } };
    let ws;
    try { ws = new WebSocket(`ws://${host || '127.0.0.1'}:${port || 4455}`); }
    catch(e){ obs.error = e.message; return finish({ success: false, error: obs.error }); }
    obs.ws = ws;
    const timer = setTimeout(() => { obs.error = 'Timed out — is OBS running with the WebSocket server enabled?'; try { ws.close(); } catch(e){} finish({ success: false, error: obs.error }); }, 6000);
    ws.onerror = () => { obs.error = 'Could not reach OBS — is it running with Tools → WebSocket Server Settings enabled?'; };
    ws.onclose = ev => {
      clearTimeout(timer); const was = obs.ready; obs.ready = false; obs.recording = false;
      if (ev && ev.code === 4009) obs.error = 'Wrong WebSocket password';
      finish({ success: false, error: obs.error || 'Connection closed' }); if (was) obsPushStatus();
    };
    ws.onmessage = async ev => {
      let m; try { m = JSON.parse(ev.data); } catch(e){ return; }
      if (m.op === 0){
        const ident = { rpcVersion: 1, eventSubscriptions: 4 | 64 };   // Scenes + Outputs
        if (m.d.authentication){
          const secret = crypto.createHash('sha256').update((password || '') + m.d.authentication.salt).digest('base64');
          ident.authentication = crypto.createHash('sha256').update(secret + m.d.authentication.challenge).digest('base64');
        }
        ws.send(JSON.stringify({ op: 1, d: ident }));
      } else if (m.op === 2){
        clearTimeout(timer); obs.ready = true; obs.error = '';
        await obsRefresh(); finish({ success: true });
      } else if (m.op === 5){
        if (m.d.eventType === 'RecordStateChanged'){ obs.recording = !!m.d.eventData.outputActive; obsPushStatus(); }
        else if (m.d.eventType === 'CurrentProgramSceneChanged'){ obs.scene = m.d.eventData.sceneName; obsPushStatus(); }
        else if (m.d.eventType === 'SceneListChanged'){ obsRefresh(); }
      } else if (m.op === 7){
        const p = obs.pending.get(m.d.requestId); if (!p) return;
        obs.pending.delete(m.d.requestId); clearTimeout(p.t);
        if (m.d.requestStatus && m.d.requestStatus.result) p.resolve(m.d); else p.reject(new Error((m.d.requestStatus && m.d.requestStatus.comment) || 'OBS request failed'));
      }
    };
  });
}
const OBS_ALLOWED = new Set(['SetCurrentProgramScene','StartRecord','StopRecord','ToggleRecord','CreateRecordChapter','GetSceneList']);
ipcMain.handle('obs-get-settings', () => ({ ...obsSettings(), status: { connected: obs.ready, recording: obs.recording, scene: obs.scene, scenes: obs.scenes, error: obs.error } }));
ipcMain.handle('obs-connect', async (_, { host, port, password, remember, autoConnect }) => {
  const cfg = readConfig();
  cfg.obs = { host: host || '127.0.0.1', port: parseInt(port, 10) || 4455, autoConnect: !!autoConnect };
  if (remember && password && safeStorage.isEncryptionAvailable()) cfg.obsPwd = safeStorage.encryptString(password).toString('base64');
  if (!remember) delete cfg.obsPwd;
  writeConfig(cfg);
  return obsConnect({ host: cfg.obs.host, port: cfg.obs.port, password: password || obsStoredPassword() });
});
ipcMain.handle('obs-disconnect', () => { obsDisconnect(); obsPushStatus(); return { success: true }; });
ipcMain.handle('obs-request', async (_, { type, data }) => {
  if (!OBS_ALLOWED.has(type)) return { success: false, error: 'Not allowed' };
  try { const r = await obsRequest(type, data || {}); return { success: true, data: r.responseData }; }
  catch(e){ return { success: false, error: e.message }; }
});
app.whenReady().then(() => setTimeout(() => {
  const o = obsSettings();
  if (o.autoConnect) obsConnect({ host: o.host, port: o.port, password: obsStoredPassword() });
}, 3000));
app.on('before-quit', () => obsDisconnect());

// ── Save a text file via the native dialog (EDL / CSV / chapters) ─────────────
ipcMain.handle('save-text-file', async (_, { defaultName, content }) => {
  try {
    const res = await dialog.showSaveDialog(win, { title: 'Save', defaultPath: path.join(app.getPath('documents'), defaultName || 'export.txt') });
    if (res.canceled || !res.filePath) return { success: false };
    fs.writeFileSync(res.filePath, content, 'utf8');
    return { success: true, filePath: res.filePath };
  } catch (err) { return { success: false, error: err.message }; }
});
