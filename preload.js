const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nabu', {
  // Window controls
  minimize:      () => ipcRenderer.send('win-minimize'),
  maximize:      () => ipcRenderer.send('win-maximize'),
  close:         () => ipcRenderer.send('win-close'),
  setFullScreen: (on) => ipcRenderer.invoke('set-fullscreen', on),
  onFullscreen:  (cb) => ipcRenderer.on('fullscreen', (_, v) => cb(v)),

  // Board file operations
  boardNew:       ()         => ipcRenderer.invoke('board-new'),
  boardSave:      (payload)  => ipcRenderer.invoke('board-save', payload),
  boardSaveAuto:  (payload)  => ipcRenderer.invoke('board-save-auto', payload),
  boardSaveUser:  (payload)  => ipcRenderer.invoke('board-save-user', payload),
  boardSaveAs:    (payload)  => ipcRenderer.invoke('board-save-as', payload),
  boardOpen:      (filePath) => ipcRenderer.invoke('board-open', filePath),
  getLastFile:    ()         => ipcRenderer.invoke('get-last-file'),
  listSaves:      ()         => ipcRenderer.invoke('list-saves'),
  openFolder:     (p)        => ipcRenderer.invoke('open-folder', p),
  getSaveDirs:    ()         => ipcRenderer.invoke('get-save-dirs'),
  setSaveDir:     ()         => ipcRenderer.invoke('set-save-dir'),
  resetSaveDir:   ()         => ipcRenderer.invoke('reset-save-dir'),

  // Image
  readImageFile:   (filePath) => ipcRenderer.invoke('read-image-file', filePath),
  pickImageFolder: ()         => ipcRenderer.invoke('pick-image-folder'),

  // Asset / file picker
  pickAssetFile: (payload) => ipcRenderer.invoke('pick-asset-file', payload),

  // Shell
  openFile:     (filePath) => ipcRenderer.invoke('open-file', filePath),
  openExternal: (url)      => ipcRenderer.invoke('open-external', url),

  // Export
  exportPng:         (payload) => ipcRenderer.invoke('export-png', payload),
  exportPngAdvanced: (payload) => ipcRenderer.invoke('export-png-advanced', payload),
  onExportInit:       (cb) => ipcRenderer.on('export-init', (_, data) => cb(data)),
  onExportSetTile:    (cb) => ipcRenderer.on('export-set-tile', (_, i) => cb(i)),
  exportFrameReady:   () => ipcRenderer.send('export-frame-ready'),
  onConvertToWebp:    (cb) => ipcRenderer.on('convert-to-webp', (_, data) => cb(data)),
  webpResult:         (id, base64) => ipcRenderer.send('webp-result', { id, base64 }),
  onStitchTiles:      (cb) => ipcRenderer.on('stitch-tiles', (_, data) => cb(data)),
  stitchResult:       (id, base64) => ipcRenderer.send('stitch-result', { id, base64 }),

  // Social embed metadata
  fetchEmbedData: (payload) => ipcRenderer.invoke('fetch-embed-data', payload),

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // OBS one-at-a-time cut-in commands (global hotkeys / HTTP / remote dock)
  onShowCmd: (cb) => ipcRenderer.on('show-cmd', (_, c) => cb(c)),

  // Auto-update
  updateCheck:    () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall:  () => ipcRenderer.send('update-install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, s) => cb(s)),

  // Presenter notes window
  openNotesWindow: () => ipcRenderer.invoke('open-notes-window'),
  sendNotesEdit:   (payload) => ipcRenderer.send('notes-edit', payload),
  onNotesEdit:     (cb) => ipcRenderer.on('notes-edit', (_, payload) => cb(payload)),
});
