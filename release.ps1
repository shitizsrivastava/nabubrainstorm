# Build the installer and publish it as a GitHub Release so installed copies can self-update.
# Usage:  .\release.ps1            (uses the version already in package.json)
# Bump "version" in package.json (and APP_VERSION in board.html) BEFORE running.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "Building NabuBrainstorm v$ver ..."
npx electron-builder --win nsis --publish never
$files = @("dist\NabuBrainstorm Setup $ver.exe", "dist\NabuBrainstorm Setup $ver.exe.blockmap", "dist\latest.yml")
gh release create "v$ver" $files --title "NabuBrainstorm v$ver" --notes "NabuBrainstorm v$ver"
Write-Host "Published v$ver. Installed apps will offer it via the Update button."
