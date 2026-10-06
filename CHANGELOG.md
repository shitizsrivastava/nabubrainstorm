# Changelog

All notable changes to NabuBrainstorm. Versions follow [Semantic Versioning](https://semver.org/).

## [1.12.0] — 2026-10-07
### Added
- **📡 OBS panel**: copy overlay links, connect to OBS WebSocket (scene switching per asset, start/stop recording,
  chapter markers at every cut-in, auto-return to previous scene), rebindable global hotkeys.
- **Per-asset cut-in settings** (position, animation, size, target seconds, auto-hide, OBS scene, sound effect, chapter title).
- **Live timer**: ● LIVE pill in the app, in the control dock and in the teleprompter; turns red over target.
- **📜 Teleprompter** window (commentary of the live asset, next-up line, size, mirror, auto-scroll).
- **🎞 Session timeline**: recorded or planned; copy YouTube chapters, export EDL (Premiere/Resolve) and CSV.
- **🖼 Thumbnail frames**: 16:9 frames, export 1280×720 JPG/PNG, duplicate as A/B variant, A/B template.
- **🔴 Laser pointer** with click pings on the Mirror overlay.
- **Help → 🎬 OBS Guide** with a START HERE step-by-step walkthrough, plus `GUIDE.md`.
- **Updates folder** (`Documents\NabuBrainstorm\Updates`): drop a newer installer in and ⟳ Update installs it; friendlier
  update errors; `update-local.ps1`.
### Changed
- **Smaller boards**: images are saved once in `Documents\NabuBrainstorm\Assets` (content-addressed) instead of inside every
  save; *Save As…* still embeds them.
- **Security**: OBS/control/media routes require a private session key (`k=` in your links), Host/Origin checks, `/media`
  limited to media file types, Range support. **Re-copy your OBS links from 📡 OBS after updating.**
- Image exporter supports JPG.

## [1.11.0] — 2026-10-07
### Added
- Windows installer (electron-builder, NSIS) — installs per-user with Start Menu / desktop shortcuts.
- In-app **⟳ Update** button (GitHub Releases via electron-updater): check → download → restart.
- **One-at-a-time OBS cut-ins**: a second Browser Source (`?obs=1&mode=solo`) shows a single numbered asset on a
  transparent background; step with global hotkeys (Ctrl+Alt+←/→/↓), the OBS control dock (`?remote=1`), or
  `GET /obs-cmd?a=next|prev|hide|goto&n=3` (Stream Deck-friendly). Videos/sounds auto-play and auto-hide.
- App icon / logo.
- `release.ps1` one-command release script; LICENSE, SECURITY, CONTRIBUTING, PROJECT_STRUCTURE docs.
### Changed
- Electron 29 → 44.

## [1.10.0] — 2026-07-05
- Presenter Notes window with Log/Edit modes, OBS transparent overlay, grouping, sub-asset attachments,
  paste-as-image, templates, offline word-theme and duplicate finders.
