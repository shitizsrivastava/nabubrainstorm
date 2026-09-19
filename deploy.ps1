$src = $PSScriptRoot
$exe = "$src\NabuBrainstorm-win32-x64\NabuBrainstorm.exe"
$appDir = "$src\NabuBrainstorm-win32-x64\resources\app"

Stop-Process -Name "NabuBrainstorm" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 1000
Copy-Item "$src\board.html","$src\main.js","$src\preload.js","$src\package.json" $appDir -Force
# Stamp today's date into the deployed board.html so the app shows when it was last updated.
# Only the build copy is changed; the source keeps the __BUILD_DATE__ token.
# Read/write via .NET with explicit UTF-8 (no BOM) so emoji/cuneiform aren't
# corrupted — Get-Content/Set-Content would re-encode multi-byte chars to mojibake.
$buildDate = Get-Date -Format "yyyy-MM-dd"
$bhPath = "$appDir\board.html"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$bhText = [System.IO.File]::ReadAllText($bhPath, [System.Text.Encoding]::UTF8)
$bhText = $bhText.Replace('__BUILD_DATE__', $buildDate)
[System.IO.File]::WriteAllText($bhPath, $bhText, $utf8NoBom)
npx --yes @electron/asar pack $appDir "$src\NabuBrainstorm-win32-x64\resources\app.asar" | Out-Null
Write-Host "Deployed. Launching..."
Start-Process $exe
