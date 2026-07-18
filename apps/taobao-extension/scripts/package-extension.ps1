$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$dist = Join-Path $root 'dist'
$staging = Join-Path $dist 'caishen-taobao-extension'
$zip = Join-Path $dist 'caishen-taobao-extension.zip'

if (Test-Path -LiteralPath $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'manifest.json') -Destination $staging
Copy-Item -LiteralPath (Join-Path $root 'README.md') -Destination $staging
Copy-Item -LiteralPath (Join-Path $root 'src') -Destination $staging -Recurse

if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
}
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -Force

Write-Host "Packaged $zip"
