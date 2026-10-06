# NabuBrainstorm — Project Structure & Architecture

Electron desktop app (Windows): a visual brainstorm board. Place text, images, PDFs, video, sound,
sticky notes, quotes and links on a canvas, connect them with bezier wires, annotate images,
present element-by-element, export PNG/WebP, and stream a transparent live overlay into OBS.
Current version: see `package.json` (`version`) and `APP_VERSION` in `board.html` — keep them equal.

## Repository layout
| Path | Purpose |
|------|---------|
| `board.html` | Entire renderer: HTML + CSS + vanilla JS (~4300 lines, ~200 functions, no framework) |
| `main.js` | Electron main process: windows, local HTTP server, OBS relay, IPC, saves, export, auto-updater |
| `preload.js` | `contextBridge` → `window.nabu.*` API (the only renderer↔main surface) |
| `package.json` | App metadata, scripts, electron-builder (NSIS) + GitHub publish config |
| `release.ps1` | Builds the installer and publishes a GitHub Release (what the Update button downloads) |
| `deploy.ps1` | Legacy dev loop: copy sources into the old `NabuBrainstorm-win32-x64` build + repack asar |
| `assets/icon.png` | App/installer icon (512×512 PNG, optional; electron-builder picks it up) |
| `CLAUDE.md` | Deep implementation notes for AI-assisted work (gotchas, design decisions) |
| `.claude/obs-test-server.js` | Static test server for previewing board.html in a browser |
| `dist/` (git-ignored) | electron-builder output: `NabuBrainstorm Setup x.y.z.exe`, `latest.yml`, blockmap |
| `NabuBrainstorm-win32-x64/` (git-ignored) | Old hand-packaged build; superseded by the installer |

## Process model
```
 Renderer (board.html)  --window.nabu.*-->  preload.js  --ipc-->  main.js
        ^                                                            |
        |   http://127.0.0.1:41414-41419 (local server, serves board.html)
        |   /obs-events (SSE)   /obs-state (POST)   /media?p= (file stream)
        v
 OBS Browser Source (board.html?obs=1)     Presenter Notes window (?notes=1)
```
- `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: false` (local media), `webviewTag: true` (social embeds).
- Board is served from a local HTTP origin (not `file://`) so embeds get a valid referrer and OBS CEF can load it.
- Ports 41414→41419 are tried first so the OBS URL survives restarts; falls back to a random port.
- Same `board.html` runs in 4 modes via query string: normal, `?obs=1` (read-only overlay), `?notes=1` (presenter notes), `?exportMode=1` (hidden export window).

## Data model (saved as `.brb` JSON)
```js
board     = { title, elements[], connectors[] }
element   = { id, type, x, y, serial, color?, notes?, groupId?, hostId?, attachments?[], ...type fields }
connector = { id, fromId, toId, fromPort?, toPort?, label?, unit?, waypoint?:{x,y} }   // ports n|s|e|w
```
| type | fields |
|------|--------|
| text / quote / sticky | `text`, `w` (light markdown `**b**`, `*i*`, `☐/☑`) |
| image | `src` (base64 JPEG ≤1400px), `w`, `h`, `annotations[]` (arrow/circle/text, % coords) |
| video / sound / pdf | `path` (Windows path), `name`, `w` |
| link / embed | `url`, `name` (YouTube/X/Instagram embeds via oEmbed) |

Relationships: **wires** (peer, gold), **groups** (`groupId`, flat peers, dashed cyan box), **sub-assets** (`hostId`/`attachments`, parent→child, purple, labelled `1.1`).
Always guard `board.connectors || []` — old saves lack it.

## Renderer (board.html) — main subsystems
- State & render: `render()` rebuilds the canvas; `elHtml(el)` per-type markup; `refreshConnSvg()` SVG-only redraw; `markDirty()` → autosave.
- Viewport: 5000×4000 canvas with CSS translate/scale; `setVPTarget()` animated pan/zoom.
- Interaction: select/lasso/drag/resize with snapping + alignment guides; wires with waypoints; Alt+drag attach; groups (Ctrl+G); undo/redo (JSON stack, cap 100).
- Presentation (F9): camera steps through elements in serial order. Capture mode (F10): hides chrome for window capture.
- Notes: per-element commentary + separate Presenter Notes window (log/edit modes).
- Extras: Quick Look modal, search (Ctrl+F), minimap, stats + offline "top words"/duplicate finder, 10 templates (`TEMPLATES`), paste-as-image (rich clipboard → JPEG), Help panel (F1).
- **Auto-update button**: `#updBtn` in the titlebar → `updateClick()` / `setupUpdater()` (end of file).

## Main process (main.js)
- Local HTTP server + OBS relay (`handleObsRoutes`).
- Saves: autosave (`Documents\NabuBrainstorm\Autosaves`, cap 30), manual (`Saved`, cap 10), Save As, restore list, custom save dir. Config: `%APPDATA%\nabu-brainstorm\nabu-config.json` (userData path is pinned in code — don't rename the `name` field or add a top-level `productName`).
- Export: simple PNG, and advanced (transparent / tiled / stitched, PNG/WebP) via a hidden BrowserWindow.
- Social oEmbed fetch (YouTube, X).
- **Auto-update**: `electron-updater` (GitHub provider). Packaged builds only. Checks 5 s after launch and on button click; `autoDownload=false`, user clicks to download, then "Restart to update". Events → `update-status` IPC.

## IPC surface (`window.nabu.*`)
- Window: minimize, maximize, close, setFullScreen, onFullscreen
- Boards: boardNew/Save/SaveAuto/SaveUser/SaveAs/Open, getLastFile, listSaves, openFolder, get/set/resetSaveDir
- Media: readImageFile, pickImageFolder, pickAssetFile, openFile, openExternal
- Export: exportPng, exportPngAdvanced (+ internal webp/stitch channels); fetchEmbedData; getVersion
- Notes: openNotesWindow, sendNotesEdit, onNotesEdit
- **Update**: updateCheck, updateDownload, updateInstall, onUpdateStatus

## OBS integration
1. **Overlay (recommended)**: OBS → Sources → Browser → `http://127.0.0.1:41414/board.html?obs=1`, 1920×1080. Real alpha, mirrors viewport/moves/F9 steps live; viewers never see the app UI.
2. **Window capture + F10** capture mode (opaque background).
3. **Presenter Notes** is a separate OS window, so it is never captured.

The overlay is read-only; media is streamed through `/media?p=` because OBS's CEF can't use `file://`.

## Build, install, update
```powershell
npm install
npm start                                                                # run from source
node node_modules/electron-builder/cli.js --win nsis --publish never     # dist\NabuBrainstorm Setup x.y.z.exe
.\release.ps1                                                            # build + gh release create
```
The folder name contains `&`, which breaks the `npx` shim on Windows — call `node node_modules/...` directly.

Release flow: bump `version` in `package.json` + `APP_VERSION` in `board.html` → commit/push → `.\release.ps1` → installed apps show "Update to vX" on the next check (or when you click **⟳ Update**).

The installer is unsigned, so Windows SmartScreen shows "More info → Run anyway" once. The GitHub repo must be **public** (or releases hosted in a public repo) for the updater to read releases without a token.

## Known risks / improvement backlog
- `/media?p=` streams any local file path to anything that can reach 127.0.0.1 → restrict to paths referenced by the board and check `Host`/`Origin`.
- `/obs-state` POST accepts any caller; add a per-session token.
- `webSecurity:false` + `webviewTag:true` widen the attack surface; scope to embed webviews only.
- Images are base64 inside `.brb` → large files; consider an external asset folder.
- No code signing, no automated tests.
