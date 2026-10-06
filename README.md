<p align="center"><img src="assets/icon.png" width="140" alt="NabuBrainstorm logo"></p>

# NabuBrainstorm

A visual brainstorm board for Windows, built for YouTube creators. Drop text, images, PDFs, video, sound, sticky notes,
quotes and links on a canvas, wire them together, number them in presentation order, and push them live into OBS —
**one asset at a time on a transparent background**, like a cut-in you'd normally do in editing.

## Features
- Infinite canvas with bezier wires, groups, sub-asset attachments, image annotations, color tags, alignment guides
- Numbered assets (1, 2, 3…) = your presentation / on-air order
- **F9 presentation mode** and **F10 capture mode** for clean recordings
- **OBS integration**
  - *Mirror overlay*: whole board, transparent, live — `http://127.0.0.1:41414/board.html?obs=1`
  - *One-at-a-time cut-ins*: `http://127.0.0.1:41414/board.html?obs=1&mode=solo` — step with **Ctrl+Alt+→ / ← / ↓**
    (works while OBS is focused), the OBS control dock `…/board.html?remote=1`, or `GET /obs-cmd?a=next|prev|hide|goto&n=3`
  - Separate **Presenter Notes** window (never captured by OBS)
- Paste anything (screenshots, Excel/web selections, YouTube/X/Instagram links), templates, search, minimap
- Autosave + restore, PNG/WebP export (transparent, tiled, stitched)
- Built-in **⟳ Update** button — installs new versions from GitHub Releases

## Install
1. Download `NabuBrainstorm Setup x.y.z.exe` from the [Releases](../../releases) page and run it.
   (The installer is unsigned: if Windows SmartScreen appears, choose **More info → Run anyway**.)
2. Later updates: click **⟳ Update** in the titlebar.

## Use with OBS (quick start)
1. In OBS: **Sources → + → Browser**, URL `http://127.0.0.1:41414/board.html?obs=1&mode=solo`, 1920×1080.
2. Optional control dock: **View → Docks → Custom Browser Docks**, URL `http://127.0.0.1:41414/board.html?remote=1`.
3. Number your assets in the app, then press **Ctrl+Alt+→** to bring up asset 1, again for 2, and so on.
   Link options: `&fit=0.8` size, `&anim=pop|fade|slide`, `&autohide=0`.

## Develop
```bash
npm install
npm start
node node_modules/electron-builder/cli.js --win nsis --publish never   # build installer into dist/
```
Release: bump `version` in `package.json` and `APP_VERSION` in `board.html`, commit, then run `.\release.ps1`.

## Documentation
[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) (architecture, data model, IPC, build) ·
[CLAUDE.md](CLAUDE.md) (implementation notes) · [CHANGELOG.md](CHANGELOG.md) ·
[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md)

## License
[MIT](LICENSE) © 2026 Shitiz Srivastava
