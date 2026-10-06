# NabuBrainstorm

Visual brainstorm board for Windows (Electron): text, images, PDFs, video, sound, sticky notes, quotes and links on a
canvas with bezier wires, image annotations, presentation mode, PNG/WebP export, and a transparent live overlay for OBS.

- **Install**: download `NabuBrainstorm Setup x.y.z.exe` from Releases and run it. Update later with the **⟳ Update** button in the titlebar.
- **Develop**: `npm install`, then `npm start`.
- **Release**: bump the version in `package.json` and `APP_VERSION` in `board.html`, then run `.\release.ps1`.
- **OBS**: Browser Source → `http://127.0.0.1:41414/board.html?obs=1` (1920×1080).
- **Docs**: [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) (architecture, data model, IPC, build) · [CLAUDE.md](CLAUDE.md) (implementation notes).
