$ErrorActionPreference = 'Stop'
$taskSource = Join-Path $PSScriptRoot 'outputs/tennis-local/chrome-extension'
$taskManifest = Get-Content -LiteralPath (Join-Path $taskSource 'manifest.json') -Raw | ConvertFrom-Json
$taskRuntime = @('manifest.json','background.js','core.js','stage-rules.js','discount.js','navigation.js','grid-read.js','page-read.js','retry.js','run-log.js','checkout.js','payment.js','reconciliation.js','link-frames.js','content.js','stage-content.js','checkout-content.js','payment-content.js','link-content.js','card-content.js','card-vault-core.js','card-vault.html','card-vault.js','popup.html','popup.js','notification.png','README.md')
$taskOutput = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskZip = Join-Path $taskOutput ('tennis-booking-v' + $taskManifest.version + '.zip')
Compress-Archive -LiteralPath ($taskRuntime | ForEach-Object { Join-Path $taskSource $_ }) -DestinationPath $taskZip -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
try {
 $taskNames = @($taskArchive.Entries.FullName)
 if($taskNames.Count -ne $taskRuntime.Count -or (Compare-Object ($taskRuntime | Sort-Object) ($taskNames | Sort-Object))) { throw 'Runtime archive does not match the reviewed file allowlist' }
} finally { $taskArchive.Dispose() }
Get-FileHash -LiteralPath $taskZip -Algorithm SHA256 | Format-List
Write-Output $taskZip
