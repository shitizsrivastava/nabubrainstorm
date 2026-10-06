# Build a new installer and put it in the app's Updates folder, so the ⟳ Update button installs it.
# Usage: bump "version" in package.json + APP_VERSION in board.html, then run:  .\update-local.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
node node_modules/electron-builder/cli.js --win nsis --publish never
$dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'NabuBrainstorm\Updates'
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item "dist\NabuBrainstorm Setup $ver.exe" $dest -Force
Write-Host "Copied v$ver to $dest — open NabuBrainstorm and click ⟳ Update."
