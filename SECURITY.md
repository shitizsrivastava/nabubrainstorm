# Security Policy

## Reporting a vulnerability
Please report security issues privately through GitHub's **Security → Report a vulnerability** on this repository
rather than opening a public issue. Expect an acknowledgement within a few days.

## Scope notes
NabuBrainstorm is a local desktop app. It runs a small HTTP server bound to `127.0.0.1` (ports 41414–41419) that
serves the board and relays state to OBS Browser Sources. It is never exposed to the network by default.
Known hardening work is tracked in the "Known risks" section of [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md).

## Supported versions
Only the latest release receives fixes.
