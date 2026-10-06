# Build the installer and publish it as a GitHub Release so installed copies can self-update.
# Usage:  .\release.ps1            (uses the version already in package.json)
# Bump "version" in package.json (and APP_VERSION in board.html) BEFORE running.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
# Stamp today's date into the "updated" label in board.html (commit this change afterwards)
$bh = Get-Content board.html -Raw -Encoding UTF8
$bh = [regex]::Replace($bh, "const BUILD_DATE  = '[^']*';", "const BUILD_DATE  = '$(Get-Date -Format yyyy-MM-dd)';")
[System.IO.File]::WriteAllText("$PSScriptRoot\board.html", $bh, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Building NabuBrainstorm v$ver ..."
node node_modules/electron-builder/cli.js --win nsis --publish never
# GitHub renames files containing spaces, so upload hyphenated copies that match latest.yml
$exe = "dist\NabuBrainstorm-Setup-$ver.exe"
Copy-Item "dist\NabuBrainstorm Setup $ver.exe" $exe -Force
Copy-Item "dist\NabuBrainstorm Setup $ver.exe.blockmap" "$exe.blockmap" -Force
$files = @($exe, "$exe.blockmap", "dist\latest.yml")
gh release create "v$ver" $files --title "NabuBrainstorm v$ver" --notes "NabuBrainstorm v$ver"
Write-Host "Published v$ver. Installed apps will offer it via the Update button."
