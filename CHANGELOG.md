# Changelog

All notable changes to NabuBrainstorm. Versions follow [Semantic Versioning](https://semver.org/).

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
