$ErrorActionPreference = 'Stop'
$taskSource = Join-Path $PSScriptRoot 'outputs/tennis-local/chrome-extension'
$taskManifest = Get-Content -LiteralPath (Join-Path $taskSource 'manifest.json') -Raw | ConvertFrom-Json
$taskRuntime = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-files.json') -Raw | ConvertFrom-Json
$taskOutput = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskZip = Join-Path $taskOutput ('tennis-booking-v' + $taskManifest.version + '.zip')
Compress-Archive -LiteralPath ($taskRuntime | ForEach-Object { Join-Path $taskSource $_ }) -DestinationPath $taskZip -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
try {
 $taskNames = @($taskArchive.Entries.FullName)
 if($taskNames.Count -ne $taskRuntime.Count -or (Compare-Object ($taskRuntime | Sort-Object) ($taskNames | Sort-Object))) { throw 'Runtime archive does not match the reviewed file allowlist' }
 foreach ($taskEntry in $taskArchive.Entries) {
  $taskStream = $taskEntry.Open()
  try { $taskHasher = [Security.Cryptography.SHA256]::Create(); $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '') }
  finally { $taskStream.Dispose(); if ($taskHasher) { $taskHasher.Dispose() } }
  if ($taskHash -ne (Get-FileHash -LiteralPath (Join-Path $taskSource $taskEntry.FullName) -Algorithm SHA256).Hash) { throw 'Runtime archive differs from tested source' }
 }
} finally { $taskArchive.Dispose() }
Get-FileHash -LiteralPath $taskZip -Algorithm SHA256 | Format-List
Write-Output $taskZip
