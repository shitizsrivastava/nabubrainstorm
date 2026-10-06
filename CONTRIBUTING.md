# Contributing

Thanks for your interest! This is a personal project, but issues and pull requests are welcome.

## Setup
```bash
npm install
npm start
```
Build the installer: `node node_modules/electron-builder/cli.js --win nsis --publish never`
(use `node`, not `npx`, if your folder path contains `&`).

## Guidelines
- The renderer is a single vanilla-JS file (`board.html`) — no framework or build step. Match the surrounding style.
- Any renderer ↔ main communication goes through `preload.js` (`window.nabu.*`); keep `contextIsolation` on.
- Add user-facing features/shortcuts to the in-app Help panel (F1) and to [CHANGELOG.md](CHANGELOG.md).
- Read [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) and [CLAUDE.md](CLAUDE.md) first — they document the gotchas.
- Keep `version` in `package.json` and `APP_VERSION` in `board.html` identical when releasing.

## Pull requests
Small, focused changes with a short description of what you tested.
