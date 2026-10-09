# Installs the IDtoAE panel (dist\IDtoAE.jsx) into the newest After Effects
# version in your user settings. Untested - please report problems.
# Run: right-click this file > Run with PowerShell
$ErrorActionPreference = "Stop"
$base = Join-Path $env:APPDATA "Adobe\After Effects"
$latest = Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $latest) { Write-Host "No After Effects settings folder found. Open After Effects once, then run this again."; exit 1 }
$dest = Join-Path $latest.FullName "Scripts\ScriptUI Panels"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $PSScriptRoot "dist\IDtoAE.jsx") $dest -Force
Write-Host "Installed IDtoAE into $dest"
Write-Host "Restart After Effects, then open Window > IDtoAE.jsx"
