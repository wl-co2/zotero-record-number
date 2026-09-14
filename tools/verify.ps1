param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$addon = Join-Path $SourceRoot "addon"
$requiredFiles = @(
  "bootstrap.js",
  "manifest.json",
  "prefs.js",
  "record-number-core.js"
)

foreach ($file in $requiredFiles) {
  if (-not (Test-Path -LiteralPath (Join-Path $addon $file))) {
    throw "Missing required add-on file: $file"
  }
}

$actualFiles = @(
  Get-ChildItem -LiteralPath $addon -File -Recurse |
    ForEach-Object { $_.FullName.Substring($addon.Length + 1).Replace("\", "/") } |
    Sort-Object
)
$expectedFiles = @($requiredFiles | Sort-Object)
if (($actualFiles -join "|") -ne ($expectedFiles -join "|")) {
  throw "Unexpected files are present in addon/: $($actualFiles -join ', ')"
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $addon "manifest.json") |
  ConvertFrom-Json
if ($manifest.applications.zotero.id -ne "zotero-record-number@wl-co2.github.io") {
  throw "Unexpected plugin ID"
}
$expectedUpdateURL = "https://raw.githubusercontent.com/wl-co2/zotero-record-number/main/updates.json"
if ($manifest.applications.zotero.update_url -ne $expectedUpdateURL) {
  throw "Unexpected manifest update URL"
}
if ($manifest.homepage_url) {
  throw "Manifest contains a homepage URL"
}

$forbiddenPattern = '(?i)\bfetch\s*\(|XMLHttpRequest|WebSocket|Zotero\.HTTP|\btelemetry\b|\banalytics\b|proGate|requirePro|pdf-lib|pdfjs|fabric'
$matches = Get-ChildItem -LiteralPath $addon -File -Recurse |
  Select-String -Pattern $forbiddenPattern
if ($matches) {
  throw "Forbidden network, telemetry, licensing, PDF, or image code found: $($matches.Path -join ', ')"
}

$unexpectedURLs = Get-ChildItem -LiteralPath $addon -File -Recurse |
  Where-Object { $_.Name -ne "manifest.json" } |
  Select-String -Pattern '(?i)https?://'
if ($unexpectedURLs) {
  throw "Unexpected URL outside manifest.json: $($unexpectedURLs.Path -join ', ')"
}

$deprecatedColumnProperties = Get-ChildItem -LiteralPath $addon -File -Recurse |
  Select-String -Pattern '\b(defaultIn|disableIn)\s*:'
if ($deprecatedColumnProperties) {
  throw "Deprecated item-tree column properties found: $($deprecatedColumnProperties.Path -join ', ')"
}

Write-Output "Static verification passed."
Write-Output "Bundled files: $($actualFiles -join ', ')"
Write-Output "Third-party runtime dependencies: none"
Write-Output "Manifest update URL: $expectedUpdateURL"
