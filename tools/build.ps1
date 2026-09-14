param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$addon = Join-Path $SourceRoot "addon"
$dist = Join-Path $SourceRoot "dist"
$destination = Join-Path $dist "zotero-record-number-1.0.4.xpi"

& (Join-Path $PSScriptRoot "verify.ps1") -SourceRoot $SourceRoot

if (-not (Test-Path -LiteralPath $dist)) {
  New-Item -ItemType Directory -Path $dist | Out-Null
}

if (Test-Path -LiteralPath $destination) {
  throw "The destination already exists. Move or remove it before rebuilding: $destination"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $addon,
  $destination,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$hash = Get-FileHash -LiteralPath $destination -Algorithm SHA256
Write-Output "Built: $destination"
Write-Output "SHA256: $($hash.Hash)"
