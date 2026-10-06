const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

// ── Save folder paths ─────────────────────────────────────────────────────────
const DEFAULT_BASE = () => path.join(app.getPath('documents'), 'NabuBrainstorm');
const BASE_DIR  = () => { const cfg = readConfig(); return cfg.customSaveDir || DEFAULT_BASE(); };
const AUTO_DIR  = () => path.join(BASE_DIR(), 'Autosaves');
const SAVED_DIR = () => path.join(BASE_DIR(), 'Saved');
function ensureDirs(){
  [BASE_DIR(), AUTO_DIR(), SAVED_DIR()].forEach(d => { if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); });
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

function handleObsRoutes(req, res, urlPath){
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
  if (urlPath === '/media'){
    // Streams a local media file so the OBS overlay (which cannot use file://
    // URLs) can show video/sound/pdf assets. Server is bound to 127.0.0.1 only.
    const p = new URL(req.url, 'http://x').searchParams.get('p') || '';
    const stream = fs.createReadStream(p);
    stream.on('error', () => { res.writeHead(404); res.end(); });
    stream.once('open', () => {
      res.writeHead(200, { 'Content-Type': SERVE_MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
      stream.pipe(res);
    });
    return true;
  }
  return false;
}

function startLocalServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
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

let serverPort = null;
let notesWin = null;

async function createWindow() {
  const port = await startLocalServer();
  serverPort = port;
  win = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 800, minHeight: 500,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,   // needed for local file:// media paths
      webviewTag: true      // needed for Instagram/social embeds in Quick Look
    }
  });
  win.loadURL(`http://127.0.0.1:${port}/board.html`);
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
  notesWin.loadURL(`http://127.0.0.1:${serverPort}/board.html?notes=1`);
  notesWin.on('closed', () => { notesWin = null; });
  return true;
});

// Edit made in the Notes window's Edit mode → relayed straight to the board
// window over IPC (not the HTTP/SSE relay — that's one-way, main → overlays).
ipcMain.on('notes-edit', (e, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send('notes-edit', payload);
});

app.whenReady().then(createWindow);
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
    fs.writeFileSync(fpath, JSON.stringify(data, null, 2), 'utf8');
    enforceCap(AUTO_DIR(), 30);
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
    fs.writeFileSync(fpath, JSON.stringify(data, null, 2), 'utf8');
    enforceCap(SAVED_DIR(), 10);
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
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
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
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const ext = format === 'webp' ? 'webp' : 'png';
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

// ── Auto-update (GitHub Releases via electron-updater) ───────────────────────
// Only active in the installed build; `npm start` (unpackaged) reports "dev".
let autoUpdater = null;
function sendUpdate(state, extra = {}){
  if (win && !win.isDestroyed()) win.webContents.send('update-status', { state, ...extra });
}
function initUpdater(){
  if (!app.isPackaged || autoUpdater) return;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
    autoUpdater.on('update-available',    i => sendUpdate('available', { version: i.version }));
    autoUpdater.on('update-not-available',() => sendUpdate('none'));
    autoUpdater.on('download-progress',   p => sendUpdate('downloading', { percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded',   i => sendUpdate('ready', { version: i.version }));
    autoUpdater.on('error',               e => sendUpdate('error', { message: String(e && e.message || e).slice(0, 200) }));
  } catch(e){ autoUpdater = null; }
}
ipcMain.handle('update-check', async () => {
  initUpdater();
  if (!autoUpdater) { sendUpdate('dev'); return { success: false, dev: true }; }
  try { await autoUpdater.checkForUpdates(); return { success: true }; }
  catch(e){ sendUpdate('error', { message: String(e.message || e).slice(0, 200) }); return { success: false }; }
});
ipcMain.handle('update-download', async () => {
  if (!autoUpdater) return { success: false };
  try { await autoUpdater.downloadUpdate(); return { success: true }; }
  catch(e){ sendUpdate('error', { message: String(e.message || e).slice(0, 200) }); return { success: false }; }
});
ipcMain.on('update-install', () => { if (autoUpdater) autoUpdater.quitAndInstall(); });
app.whenReady().then(() => setTimeout(() => { initUpdater(); if (autoUpdater) autoUpdater.checkForUpdates().catch(()=>{}); }, 5000));
